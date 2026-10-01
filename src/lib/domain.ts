/**
 * BlindBench domain rules — pure functions shared by the worker (actions, jobs)
 * and the client (standings view). No I/O here, so every rule is unit-tested in
 * domain.test.ts.
 */

/* ── Limits ─────────────────────────────────────────────────────────────── */

export const LIMITS = {
  minModels: 2,
  maxModels: 3,
  minPrompts: 1,
  maxPrompts: 8,
  titleMax: 80,
  promptMax: 2000,
  guidanceMax: 1000,
  answerMaxOutputTokens: 700,
  importedAnswerMax: 8000,
} as const

/** Models the owner may pick. Cheap/fast tier from three providers by default. */
export const MODEL_CHOICES = [
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Claude Sonnet 5' },
  { id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna' },
  { id: 'gpt-6-sol', provider: 'openai', label: 'GPT-6 Sol' },
  { id: 'gpt-oss-120b', provider: 'cerebras', label: 'gpt-oss-120b (Cerebras)' },
] as const

export type ModelId = (typeof MODEL_CHOICES)[number]['id']
export type Provider = (typeof MODEL_CHOICES)[number]['provider']

export function findModel(id: unknown) {
  return MODEL_CHOICES.find((m) => m.id === id) ?? null
}

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

export type EvalStatus =
  | 'draft' // created, nothing generated yet
  | 'generating' // background job running
  | 'needs_attention' // generation finished with failed answers on included prompts
  | 'ready' // every included answer succeeded; voting can open
  | 'voting' // frozen: prompts/answers/pairs immutable, votes accepted
  | 'closed' // no more votes; model names revealed

const TRANSITIONS: Record<EvalStatus, EvalStatus[]> = {
  draft: ['generating', 'ready'], // generate, or import answers
  generating: ['ready', 'needs_attention'],
  needs_attention: ['generating', 'ready'], // retry, or exclude prompts until ready
  ready: ['voting'],
  voting: ['closed'],
  closed: [],
}

export function canTransition(from: EvalStatus, to: EvalStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** Answers / prompts may only change before voting opens. */
export function isFrozen(status: EvalStatus): boolean {
  return status === 'voting' || status === 'closed'
}

/* ── Input validation (createEval) ──────────────────────────────────────── */

export interface EvalInput {
  title: string
  guidance: string
  prompts: string[]
  models: string[]
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

export function validateEvalInput(raw: unknown): Validated<EvalInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Missing input' }
  const r = raw as Record<string, unknown>

  const title = typeof r.title === 'string' ? r.title.trim() : ''
  if (!title) return { ok: false, error: 'Title is required' }
  if (title.length > LIMITS.titleMax) return { ok: false, error: `Title must be at most ${LIMITS.titleMax} characters` }

  const guidance = typeof r.guidance === 'string' ? r.guidance.trim() : ''
  if (guidance.length > LIMITS.guidanceMax) return { ok: false, error: `Guidance must be at most ${LIMITS.guidanceMax} characters` }

  if (!Array.isArray(r.prompts)) return { ok: false, error: 'Prompts must be a list' }
  const prompts = r.prompts.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean)
  if (prompts.length < LIMITS.minPrompts) return { ok: false, error: 'Add at least one prompt' }
  if (prompts.length > LIMITS.maxPrompts) return { ok: false, error: `At most ${LIMITS.maxPrompts} prompts` }
  if (prompts.some((p) => p.length > LIMITS.promptMax)) return { ok: false, error: `Each prompt must be at most ${LIMITS.promptMax} characters` }

  if (!Array.isArray(r.models)) return { ok: false, error: 'Models must be a list' }
  const models = [...new Set(r.models.filter((m): m is string => typeof m === 'string'))]
  if (models.length !== r.models.length) return { ok: false, error: 'Pick each model only once' }
  if (models.length < LIMITS.minModels || models.length > LIMITS.maxModels) {
    return { ok: false, error: `Pick ${LIMITS.minModels}–${LIMITS.maxModels} models` }
  }
  const unknown = models.find((m) => !findModel(m))
  if (unknown) return { ok: false, error: `Unknown model: ${unknown}` }

  return { ok: true, value: { title, guidance, prompts, models } }
}

/** Anonymous labels shown until the owner closes voting. Never derived from model ids. */
export function anonymousLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Model ${String.fromCharCode(65 + i)}`)
}

/* ── Pairs ──────────────────────────────────────────────────────────────── */

export interface PairSpec {
  promptId: string
  /** canonical order: contestant index a < b */
  a: number
  b: number
}

/** One canonical pair per prompt per contestant combination: 3 models × 8 prompts = 24. */
export function buildPairs(promptIds: string[], contestantCount: number): PairSpec[] {
  const out: PairSpec[] = []
  for (const promptId of promptIds) {
    for (let a = 0; a < contestantCount; a++) {
      for (let b = a + 1; b < contestantCount; b++) out.push({ promptId, a, b })
    }
  }
  return out
}

/** FNV-1a 32-bit — deterministic, dependency-free, same result in worker and browser. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Whether a voter sees the canonical pair flipped (B on the left). Recomputed
 * server-side when the vote arrives, so the client never asserts orientation.
 */
export function isFlipped(voterId: string, pairId: string): boolean {
  return (hash32(`${voterId}:${pairId}`) & 1) === 1
}

export type PresentedChoice = 'left' | 'right' | 'tie' | 'both_bad'
export type Outcome = 'a' | 'b' | 'tie' | 'both_bad'

export function isPresentedChoice(v: unknown): v is PresentedChoice {
  return v === 'left' || v === 'right' || v === 'tie' || v === 'both_bad'
}

export function toOutcome(choice: PresentedChoice, flipped: boolean): Outcome {
  if (choice === 'tie' || choice === 'both_bad') return choice
  const leftIsA = !flipped
  if (choice === 'left') return leftIsA ? 'a' : 'b'
  return leftIsA ? 'b' : 'a'
}

/**
 * Pick the next pair for a voter: least-reviewed eligible pair first (coverage),
 * ties broken by a per-voter hash so concurrent voters spread out instead of
 * all landing on the same pair.
 */
export function pickNextPair(
  pairIds: string[],
  votesPerPair: Map<string, number>,
  alreadyVoted: Set<string>,
  voterId: string,
): string | null {
  let best: string | null = null
  let bestCount = Infinity
  let bestTie = Infinity
  for (const id of pairIds) {
    if (alreadyVoted.has(id)) continue
    const count = votesPerPair.get(id) ?? 0
    const tie = hash32(`${voterId}|${id}`)
    if (count < bestCount || (count === bestCount && tie < bestTie)) {
      best = id
      bestCount = count
      bestTie = tie
    }
  }
  return best
}

/* ── Standings (descriptive, order-independent) ─────────────────────────── */

export interface VoteRow {
  labelA: string
  labelB: string
  outcome: Outcome
}

export interface StandingRow {
  label: string
  wins: number
  losses: number
  ties: number
  bothBad: number
  /** wins / (wins + losses); null when there are no decisive votes */
  decisiveWinRate: number | null
  decisiveVotes: number
}

export function computeStandings(labels: string[], votes: VoteRow[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    labels.map((label) => [label, { label, wins: 0, losses: 0, ties: 0, bothBad: 0, decisiveWinRate: null, decisiveVotes: 0 }]),
  )
  for (const v of votes) {
    const a = rows.get(v.labelA)
    const b = rows.get(v.labelB)
    if (!a || !b) continue // vote for an unknown label: ignore rather than invent a row
    if (v.outcome === 'a') { a.wins++; b.losses++ }
    else if (v.outcome === 'b') { b.wins++; a.losses++ }
    else if (v.outcome === 'tie') { a.ties++; b.ties++ }
    else { a.bothBad++; b.bothBad++ }
  }
  for (const r of rows.values()) {
    r.decisiveVotes = r.wins + r.losses
    r.decisiveWinRate = r.decisiveVotes > 0 ? r.wins / r.decisiveVotes : null
  }
  // Sort by win rate (nulls last), then by decisive volume, then label for stability.
  return [...rows.values()].sort((x, y) => {
    const xr = x.decisiveWinRate ?? -1
    const yr = y.decisiveWinRate ?? -1
    if (yr !== xr) return yr - xr
    if (y.decisiveVotes !== x.decisiveVotes) return y.decisiveVotes - x.decisiveVotes
    return x.label.localeCompare(y.label)
  })
}

/** Generation outcome after a job pass, given included answers' statuses. */
export function statusAfterGeneration(answerStatuses: Array<'pending' | 'done' | 'failed'>): EvalStatus {
  if (answerStatuses.some((s) => s === 'pending')) return 'generating'
  return answerStatuses.some((s) => s === 'failed') ? 'needs_attention' : 'ready'
}

/** answers[promptIndex][contestantIndex], every cell non-empty. */
export function validateImportMatrix(raw: unknown, prompts: number, models: number): Validated<string[][]> {
  if (!Array.isArray(raw) || raw.length !== prompts) return { ok: false, error: `Provide answers for all ${prompts} prompts` }
  const out: string[][] = []
  for (let i = 0; i < prompts; i++) {
    const row = raw[i]
    if (!Array.isArray(row) || row.length !== models) return { ok: false, error: `Prompt ${i + 1} needs ${models} answers` }
    const cells = row.map((c) => (typeof c === 'string' ? c.trim() : ''))
    const empty = cells.findIndex((c) => !c)
    if (empty !== -1) return { ok: false, error: `Prompt ${i + 1}, answer ${empty + 1} is empty` }
    if (cells.some((c) => c.length > LIMITS.importedAnswerMax)) return { ok: false, error: `Answers must be at most ${LIMITS.importedAnswerMax} characters` }
    out.push(cells)
  }
  return { ok: true, value: out }
}
