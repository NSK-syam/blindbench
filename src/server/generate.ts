/**
 * Answer generation — runs inside the 'generate' background job.
 *
 * Each tick generates up to CONCURRENCY pending answers, writes the result to
 * the owner-only `answers` rows, reports progress, and yields with
 * ctx.continue(). Short ticks keep each alarm well under the Workers limits and
 * make the job resumable if the isolate restarts mid-run.
 */

import { generateText } from 'ai'
import { buildCronContext, createDeepSpaceAI } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { findModel, LIMITS, statusAfterGeneration } from '../lib/domain'
import type { AnswerData, ContestantData, EvalData, PromptData } from '../types'
import type { Envelope } from './records'

const CONCURRENCY = 3
const CALL_TIMEOUT_MS = 90_000
const SYSTEM_PROMPT = 'You are a helpful assistant. Answer the request directly and completely. Do not mention which model or company you are.'

type Records = ReturnType<typeof buildCronContext>['records']

async function rows<T>(records: Records, collection: string, where: Record<string, unknown>): Promise<Envelope<T>[]> {
  return (await records.query(collection, { where, limit: 2000 })) as Envelope<T>[]
}

/** Provider errors can name the model; keep them short and owner-only. */
function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.slice(0, 300)
}

async function generateOne(env: Env, modelId: string, prompt: string, signal: AbortSignal): Promise<string> {
  const model = findModel(modelId)
  if (!model) throw new Error(`Model ${modelId} is no longer offered`)
  const provider = createDeepSpaceAI(env, model.provider) // billed to the app owner
  const { text } = await generateText({
    model: provider(model.id),
    system: SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: LIMITS.answerMaxOutputTokens,
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
  })
  if (!text.trim()) throw new Error('Empty response')
  return text.trim()
}

export async function runGenerateJob(job: Job, jobCtx: JobContext, env: Env): Promise<unknown> {
  const { evalId } = (job.payload ?? {}) as { evalId?: string }
  if (!evalId) throw new Error('generate: missing evalId')
  const { records } = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)

  const [evalRow] = await rows<EvalData>(records, 'evals', { recordId: evalId })
  if (!evalRow) throw new Error('generate: eval not found')
  // Only the eval owner's own enqueue may spend credits, and only while generating.
  if (job.enqueuedBy && job.enqueuedBy !== evalRow.data.ownerId) throw new Error('generate: not enqueued by the eval owner')
  if (evalRow.data.status !== 'generating') return { skipped: evalRow.data.status }

  const [contestants, prompts, answers] = await Promise.all([
    rows<ContestantData>(records, 'contestants', { evalId }),
    rows<PromptData>(records, 'prompts', { evalId }),
    rows<AnswerData>(records, 'answers', { evalId }),
  ])
  const included = new Set(prompts.filter((p) => !p.data.excluded).map((p) => p.recordId))
  const promptText = new Map(prompts.map((p) => [p.recordId, p.data.text]))
  const modelOf = new Map(contestants.map((c) => [c.recordId, c.data.modelId]))
  const relevant = answers.filter((a) => included.has(a.data.promptId))
  const pending = relevant.filter((a) => a.data.status === 'pending')

  const batch = pending.slice(0, CONCURRENCY)
  const results = await Promise.allSettled(batch.map(async (a) => {
    const started = Date.now()
    try {
      const text = await generateOne(env, modelOf.get(a.data.contestantId) ?? '', promptText.get(a.data.promptId) ?? '', jobCtx.signal)
      await records.update('answers', a.recordId, { status: 'done', text, error: '', latencyMs: Date.now() - started, attempts: (a.data.attempts ?? 0) + 1 })
      return 'done' as const
    } catch (err) {
      await records.update('answers', a.recordId, { status: 'failed', error: errorText(err), latencyMs: Date.now() - started, attempts: (a.data.attempts ?? 0) + 1 })
      return 'failed' as const
    }
  }))
  const outcome = new Map(batch.map((a, i) => [a.recordId, results[i].status === 'fulfilled' ? results[i].value : 'failed']))

  const statuses = relevant.map((a) => outcome.get(a.recordId) ?? a.data.status)
  const finished = statuses.filter((s) => s !== 'pending').length
  // Counts only: the job room is visible to every signed-in user.
  jobCtx.progress(relevant.length ? finished / relevant.length : 1, `${finished}/${relevant.length} answers`)

  if (statuses.some((s) => s === 'pending') && !jobCtx.signal.aborted) {
    jobCtx.continue({ finished }, { afterMs: 0 })
    return
  }
  const next = statusAfterGeneration(statuses.map((s) => (s === 'pending' ? 'failed' : s)))
  await records.update('evals', evalId, { status: next })
  return { finished, failed: statuses.filter((s) => s === 'failed').length }
}
