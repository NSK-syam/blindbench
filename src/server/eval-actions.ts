/**
 * Server actions — the only write path for BlindBench data.
 *
 * Every handler re-reads current state and checks the lifecycle before
 * writing; the client is never trusted for status, orientation, ownership or
 * vote identity. Errors returned to callers are generic: provider errors stay
 * on owner-only answer rows so they can't leak a model name to voters.
 */

import { enqueueJob, isAnonymousUserId, resolveAppRole } from 'deepspace/worker'
import type { ActionContext, ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  anonymousLabels,
  buildPairs,
  canTransition,
  votedBeforeClose,
  findModel,
  isFlipped,
  isPresentedChoice,
  pickNextPair,
  statusAfterGeneration,
  toOutcome,
  validateEvalInput,
  validateImportMatrix,
} from '../lib/domain'
import type {
  AnswerData, ContestantData, EvalData, PairData, PresentedPair, PromptData, RevealData, RevealRow, VoteData,
} from '../types'
import { ActionError, getOne, must, queryAll, type Envelope } from './records'

type Ctx = ActionContext<Env>

const ok = <T>(data: T): ActionResult<T> => ({ success: true, data })
const fail = (error: string): ActionResult<never> => ({ success: false, error })

/** Wrap a handler so thrown ActionErrors become clean refusals and anything
 *  unexpected becomes a generic message (details go to worker logs only). */
function handler<T>(fn: (ctx: Ctx) => Promise<ActionResult<T>>): ActionHandler<Env> {
  return async (ctx) => {
    try {
      if (!ctx.userId || isAnonymousUserId(ctx.userId)) return fail('Sign in first')
      return await fn(ctx as Ctx)
    } catch (err) {
      if (err instanceof ActionError) return fail(err.message)
      console.error('[blindbench] action failed', err instanceof Error ? err.message : String(err))
      return fail('Something went wrong. Try again.')
    }
  }
}

function str(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== 'string' || !v) throw new ActionError(`Missing ${key}`)
  return v
}

async function loadEval(tools: ActionTools, evalId: string): Promise<Envelope<EvalData>> {
  const e = await getOne<EvalData>(tools, 'evals', evalId)
  if (!e) throw new ActionError('Eval not found')
  return e
}

function requireOwner(e: Envelope<EvalData>, userId: string) {
  if (e.data.ownerId !== userId) throw new ActionError('Only the eval owner can do that')
}

/** createdAt of the eval's closure row: the immutable voting cutoff, or null while open.
 *  A query (not getOne) so an unreadable closure throws instead of reading as "open". */
async function closeCutoff(tools: ActionTools, evalId: string): Promise<string | null> {
  return (await queryAll<{ evalId: string }>(tools, 'closures', { evalId }))[0]?.createdAt ?? null
}

function requireTransition(e: Envelope<EvalData>, to: EvalData['status']) {
  if (!canTransition(e.data.status, to)) throw new ActionError(`Not allowed while the eval is ${e.data.status.replace('_', ' ')}`)
}

/** Generation spends the app owner's credits, so only the app owner/admins may start it.
 *  Creating an eval and importing answers is free and open to any signed-in user. */
async function requireCreditSpender(ctx: Ctx) {
  if (ctx.env.OWNER_USER_ID && ctx.userId === ctx.env.OWNER_USER_ID) return
  const role = await resolveAppRole(ctx.env, ctx.userId)
  if (role !== 'admin') throw new ActionError('Only the app owner or an admin can generate answers. You can import answers instead.')
}

function enqueueGeneration(env: Env, evalId: string, userId: string) {
  return enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'generate', { evalId }, { maxAttempts: 1, enqueuedBy: userId })
}

function shuffled<T>(xs: T[]): T[] {
  const out = [...xs]
  const rnd = new Uint32Array(out.length)
  crypto.getRandomValues(rnd)
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function includedPromptIds(tools: ActionTools, evalId: string): Promise<Set<string>> {
  const prompts = await queryAll<PromptData>(tools, 'prompts', { evalId })
  return new Set(prompts.filter((p) => !p.data.excluded).map((p) => p.recordId))
}

/* ── Owner actions ──────────────────────────────────────────────────────── */

const createEval = handler(async (ctx) => {
  const v = validateEvalInput(ctx.params)
  if (!v.ok) return fail(v.error)
  const { title, guidance, prompts, models } = v.value
  const labels = anonymousLabels(models.length)

  const { recordId: evalId } = await must(ctx.tools.create('evals', {
    title, guidance, status: 'draft', ownerId: ctx.userId, labels,
    promptCount: prompts.length, pairCount: 0, answerSource: '',
  }), 'Create eval')

  // Random label assignment: the order the owner picked models in says nothing about "Model A".
  const order = shuffled(models)
  for (let i = 0; i < order.length; i++) {
    await must(ctx.tools.create('contestants', { evalId, ownerId: ctx.userId, index: i, label: labels[i], modelId: order[i] }), 'Create contestant')
  }
  for (let i = 0; i < prompts.length; i++) {
    await must(ctx.tools.create('prompts', { evalId, index: i, text: prompts[i], excluded: 0 }), 'Create prompt')
  }
  return ok({ evalId })
})

const startGeneration = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  requireOwner(e, ctx.userId)
  requireTransition(e, 'generating')
  await requireCreditSpender(ctx)
  if (e.data.status !== 'draft') throw new ActionError('Use "Retry failed" for an eval that already ran')

  const evalId = e.recordId
  const contestants = await queryAll<ContestantData>(ctx.tools, 'contestants', { evalId })
  const prompts = await queryAll<PromptData>(ctx.tools, 'prompts', { evalId })
  // Deterministic answer ids: a double-click upserts the same rows instead of duplicating work.
  for (const p of prompts) {
    for (const c of contestants) {
      await must(ctx.tools.create('answers', {
        evalId, ownerId: ctx.userId, promptId: p.recordId, contestantId: c.recordId, status: 'pending', attempts: 0,
      }, `${p.recordId}--${c.recordId}`), 'Create answer')
    }
  }
  await must(ctx.tools.update('evals', evalId, { status: 'generating', answerSource: 'generated' }), 'Update eval')
  await enqueueGeneration(ctx.env, evalId, ctx.userId)
  return ok({ answers: prompts.length * contestants.length })
})

/**
 * Free alternative to generation: the owner pastes answers they already have
 * (matrix[promptIndex][contestantIndex]). Marked as imported everywhere it's
 * shown, so it is never presented as live generation.
 */
const importAnswers = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  requireOwner(e, ctx.userId)
  if (e.data.status !== 'draft') throw new ActionError('Answers can only be imported into a draft eval')
  const matrix = ctx.params.answers
  const evalId = e.recordId
  const contestants = (await queryAll<ContestantData>(ctx.tools, 'contestants', { evalId })).sort((x, y) => x.data.index - y.data.index)
  const prompts = (await queryAll<PromptData>(ctx.tools, 'prompts', { evalId })).sort((x, y) => x.data.index - y.data.index)
  const v = validateImportMatrix(matrix, prompts.length, contestants.length)
  if (!v.ok) return fail(v.error)
  for (let i = 0; i < prompts.length; i++) {
    for (let j = 0; j < contestants.length; j++) {
      await must(ctx.tools.create('answers', {
        evalId, ownerId: ctx.userId, promptId: prompts[i].recordId, contestantId: contestants[j].recordId,
        status: 'done', text: v.value[i][j], attempts: 0,
      }, `${prompts[i].recordId}--${contestants[j].recordId}`), 'Save answer')
    }
  }
  await must(ctx.tools.update('evals', evalId, { status: 'ready', answerSource: 'imported' }), 'Update eval')
  return ok({ imported: prompts.length * contestants.length })
})

const retryFailed = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  requireOwner(e, ctx.userId)
  if (e.data.status !== 'needs_attention') throw new ActionError('Nothing to retry')
  await requireCreditSpender(ctx)
  const included = await includedPromptIds(ctx.tools, e.recordId)
  const failed = (await queryAll<AnswerData>(ctx.tools, 'answers', { evalId: e.recordId, status: 'failed' }))
    .filter((a) => included.has(a.data.promptId))
  if (failed.length === 0) throw new ActionError('Nothing to retry')
  for (const a of failed) await must(ctx.tools.update('answers', a.recordId, { status: 'pending', error: '' }), 'Reset answer')
  await must(ctx.tools.update('evals', e.recordId, { status: 'generating' }), 'Update eval')
  await enqueueGeneration(ctx.env, e.recordId, ctx.userId)
  return ok({ retried: failed.length })
})

/** Remove a prompt from every model's comparison set (e.g. one model keeps failing on it). */
const excludePrompt = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  requireOwner(e, ctx.userId)
  if (e.data.status !== 'needs_attention' && e.data.status !== 'ready') {
    throw new ActionError('Prompts can only be excluded after generation and before voting opens')
  }
  const prompt = await getOne<PromptData>(ctx.tools, 'prompts', str(ctx.params, 'promptId'))
  if (!prompt || prompt.data.evalId !== e.recordId) throw new ActionError('Prompt not found')

  const included = await includedPromptIds(ctx.tools, e.recordId)
  included.delete(prompt.recordId)
  if (included.size === 0) throw new ActionError('Keep at least one prompt')
  await must(ctx.tools.update('prompts', prompt.recordId, { excluded: 1 }), 'Exclude prompt')

  const answers = (await queryAll<AnswerData>(ctx.tools, 'answers', { evalId: e.recordId }))
    .filter((a) => included.has(a.data.promptId))
  const next = statusAfterGeneration(answers.map((a) => a.data.status))
  if (next !== e.data.status) await must(ctx.tools.update('evals', e.recordId, { status: next }), 'Update eval')
  return ok({ status: next })
})

/** Freeze the eval and build one canonical pair per prompt per model combination. */
const openVoting = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  requireOwner(e, ctx.userId)
  requireTransition(e, 'voting')
  const evalId = e.recordId
  // A stale request (read 'ready' before a concurrent open + close) must not reopen.
  if (await closeCutoff(ctx.tools, evalId)) throw new ActionError('Voting already closed')

  const contestants = (await queryAll<ContestantData>(ctx.tools, 'contestants', { evalId })).sort((x, y) => x.data.index - y.data.index)
  const included = [...await includedPromptIds(ctx.tools, evalId)]
  const answers = await queryAll<AnswerData>(ctx.tools, 'answers', { evalId })
  const byKey = new Map(answers.map((a) => [`${a.data.promptId}|${a.data.contestantId}`, a]))

  const specs = buildPairs(included, contestants.length)
  for (const s of specs) {
    const A = byKey.get(`${s.promptId}|${contestants[s.a].recordId}`)
    const B = byKey.get(`${s.promptId}|${contestants[s.b].recordId}`)
    if (A?.data.status !== 'done' || B?.data.status !== 'done') throw new ActionError('Every included prompt needs a successful answer from every model')
  }
  for (const s of specs) {
    const A = byKey.get(`${s.promptId}|${contestants[s.a].recordId}`)!
    const B = byKey.get(`${s.promptId}|${contestants[s.b].recordId}`)!
    await must(ctx.tools.create('pairs', {
      evalId, ownerId: ctx.userId, promptId: s.promptId, answerAId: A.recordId, answerBId: B.recordId,
      labelA: contestants[s.a].data.label, labelB: contestants[s.b].data.label,
    }, `${evalId}--${s.promptId}--${s.a}${s.b}`), 'Create pair')
  }
  await must(ctx.tools.update('evals', evalId, { status: 'voting', pairCount: specs.length, openedAt: Date.now() }), 'Open voting')
  if (await closeCutoff(ctx.tools, evalId)) {
    await must(ctx.tools.update('evals', evalId, { status: 'closed' }), 'Restore closed')
    throw new ActionError('Voting already closed')
  }
  return ok({ pairs: specs.length })
})

const closeVoting = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  requireOwner(e, ctx.userId)
  requireTransition(e, 'closed')
  // Fix the cutoff first. A repeat or concurrent close upserts the same row and
  // keeps its original createdAt, so the cutoff never moves.
  await must(ctx.tools.create('closures', { evalId: e.recordId }, e.recordId), 'Close voting')
  await must(ctx.tools.update('evals', e.recordId, { status: 'closed', closedAt: Date.now() }), 'Close voting')
  return ok({ status: 'closed' })
})

/* ── Voter actions ──────────────────────────────────────────────────────── */

/**
 * Orientation key. The pair id alone is visible to the voter and encodes label
 * positions (…--01), and isFlipped ships in the client bundle, so a voter could
 * work out which side is "Model A" before voting. The answer ids derive from
 * contestant record ids, which only the owner can read. (Not a strong secret: a
 * voter's own decisive vote row, or matching answer text across sibling pairs,
 * still hints at orientation afterwards.)
 */
function orientationKey(pair: Envelope<PairData>): string {
  return `${pair.recordId}|${pair.data.answerAId}|${pair.data.answerBId}`
}

const nextPair = handler<PresentedPair | null>(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  if (e.data.status !== 'voting') return ok(null)
  const evalId = e.recordId
  if (await closeCutoff(ctx.tools, evalId)) return ok(null)

  const pairs = await queryAll<PairData>(ctx.tools, 'pairs', { evalId })
  const votes = await queryAll<VoteData>(ctx.tools, 'votes', { evalId })
  const perPair = new Map<string, number>()
  const mine = new Set<string>()
  for (const v of votes) {
    perPair.set(v.data.pairId, (perPair.get(v.data.pairId) ?? 0) + 1)
    if (v.data.voterId === ctx.userId) mine.add(v.data.pairId)
  }
  const pairId = pickNextPair(pairs.map((p) => p.recordId), perPair, mine, ctx.userId)
  if (!pairId) return ok(null)

  const pair = pairs.find((p) => p.recordId === pairId)!
  const [a, b, prompt] = await Promise.all([
    getOne<AnswerData>(ctx.tools, 'answers', pair.data.answerAId),
    getOne<AnswerData>(ctx.tools, 'answers', pair.data.answerBId),
    getOne<PromptData>(ctx.tools, 'prompts', pair.data.promptId),
  ])
  if (!a || !b || !prompt) throw new ActionError('This comparison is unavailable')
  const flipped = isFlipped(ctx.userId, orientationKey(pair))
  return ok({
    pairId,
    prompt: prompt.data.text,
    guidance: e.data.guidance,
    left: (flipped ? b : a).data.text ?? '',
    right: (flipped ? a : b).data.text ?? '',
    done: mine.size,
    total: pairs.length,
  })
})

const castVote = handler(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  if (e.data.status !== 'voting' || await closeCutoff(ctx.tools, e.recordId)) throw new ActionError('Voting is closed')
  const choice = ctx.params.choice
  if (!isPresentedChoice(choice)) throw new ActionError('Invalid choice')
  const pair = await getOne<PairData>(ctx.tools, 'pairs', str(ctx.params, 'pairId'))
  if (!pair || pair.data.evalId !== e.recordId) throw new ActionError('Comparison not found')

  // Fast, friendly refusal. The uniqueOn constraint below is the real guarantee
  // (this read and the write are not atomic).
  const existing = await queryAll<VoteData>(ctx.tools, 'votes', { pairId: pair.recordId, voterId: ctx.userId })
  if (existing.length > 0) throw new ActionError('You already voted on this comparison')

  // Orientation is recomputed here, never taken from the client.
  const outcome = toOutcome(choice, isFlipped(ctx.userId, orientationKey(pair)))
  const res = await ctx.tools.create('votes', {
    evalId: e.recordId, pairId: pair.recordId, voterId: ctx.userId,
    labelA: pair.data.labelA, labelB: pair.data.labelB, outcome,
  })
  // The RecordRoom's uniqueOn(pairId, voterId) refuses a second vote atomically,
  // including two concurrent requests from the same voter.
  if (!res.success) {
    if (/duplicate/i.test(res.error ?? '')) throw new ActionError('You already voted on this comparison')
    throw new ActionError('Could not record your vote')
  }
  // The checks above and the write are not atomic. A vote written at or after the
  // close cutoff never counts (votedBeforeClose, applied by reveal and standings);
  // tell the voter and remove the row as best-effort cleanup.
  const cutoff = await closeCutoff(ctx.tools, e.recordId)
  if (cutoff) {
    const mine = await getOne<VoteData>(ctx.tools, 'votes', res.data!.recordId)
    if (!mine) throw new ActionError('Could not confirm your vote')
    if (!votedBeforeClose(mine.createdAt, cutoff)) {
      await ctx.tools.remove('votes', mine.recordId)
      throw new ActionError('Voting is closed')
    }
  }
  return ok({ recorded: true })
})

/** Model names, only after the owner closes voting. */
const getReveal = handler<RevealData>(async (ctx) => {
  const e = await loadEval(ctx.tools, str(ctx.params, 'evalId'))
  if (e.data.status !== 'closed') throw new ActionError('Results are revealed after voting closes')
  const evalId = e.recordId
  const cutoff = await closeCutoff(ctx.tools, evalId)
  const [contestants, prompts, pairs, votes] = await Promise.all([
    queryAll<ContestantData>(ctx.tools, 'contestants', { evalId }),
    queryAll<PromptData>(ctx.tools, 'prompts', { evalId }),
    queryAll<PairData>(ctx.tools, 'pairs', { evalId }),
    queryAll<VoteData>(ctx.tools, 'votes', { evalId }).then((vs) => vs.filter((v) => votedBeforeClose(v.createdAt, cutoff))),
  ])
  const modelOf = new Map(contestants.map((c) => [c.data.label, c.data.modelId]))
  const promptOf = new Map(prompts.map((p) => [p.recordId, p.data]))
  const rows: RevealRow[] = pairs.map((p) => {
    const vs = votes.filter((v) => v.data.pairId === p.recordId)
    const count = (o: string) => vs.filter((v) => v.data.outcome === o).length
    const pr = promptOf.get(p.data.promptId)
    return {
      promptIndex: pr?.index ?? 0, prompt: pr?.text ?? '',
      labelA: p.data.labelA, labelB: p.data.labelB,
      modelA: modelOf.get(p.data.labelA) ?? '?', modelB: modelOf.get(p.data.labelB) ?? '?',
      a: count('a'), b: count('b'), tie: count('tie'), bothBad: count('both_bad'),
    }
  }).sort((x, y) => x.promptIndex - y.promptIndex || x.labelA.localeCompare(y.labelA) || x.labelB.localeCompare(y.labelB))
  return ok({
    contestants: contestants
      .sort((x, y) => x.data.index - y.data.index)
      .map((c) => ({ label: c.data.label, modelId: c.data.modelId, modelLabel: findModel(c.data.modelId)?.label ?? c.data.modelId })),
    rows,
  })
})

export const evalActions: Record<string, ActionHandler<Env>> = {
  createEval, startGeneration, importAnswers, retryFailed, excludePrompt, openVoting, closeVoting, nextPair, castVote, getReveal,
}
