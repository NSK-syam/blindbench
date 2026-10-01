import { describe, expect, it } from 'vitest'
import {
  anonymousLabels,
  buildPairs,
  canTransition,
  computeStandings,
  isFlipped,
  isFrozen,
  pickNextPair,
  statusAfterGeneration,
  toOutcome,
  validateEvalInput,
  validateImportMatrix,
} from './domain'

const valid = {
  title: 'Support replies',
  guidance: 'Prefer correct and concise.',
  prompts: ['How do I reset my password?', 'Refund policy?'],
  models: ['claude-haiku-4-5', 'gpt-6-luna', 'gpt-oss-120b'],
}

describe('validateEvalInput', () => {
  it('accepts a valid eval and trims fields', () => {
    const r = validateEvalInput({ ...valid, title: '  Support replies  ', prompts: [' a ', '', 'b'] })
    expect(r.ok && r.value.title).toBe('Support replies')
    expect(r.ok && r.value.prompts).toEqual(['a', 'b'])
  })
  it('rejects too many prompts', () => {
    expect(validateEvalInput({ ...valid, prompts: Array(9).fill('p') }).ok).toBe(false)
  })
  it('rejects one model, four models, duplicates and unknown ids', () => {
    expect(validateEvalInput({ ...valid, models: ['gpt-6-luna'] }).ok).toBe(false)
    expect(validateEvalInput({ ...valid, models: ['claude-haiku-4-5', 'gpt-6-luna', 'gpt-oss-120b', 'gpt-6-sol'] }).ok).toBe(false)
    expect(validateEvalInput({ ...valid, models: ['gpt-6-luna', 'gpt-6-luna'] }).ok).toBe(false)
    expect(validateEvalInput({ ...valid, models: ['gpt-6-luna', 'made-up'] }).ok).toBe(false)
  })
  it('rejects missing title and non-object input', () => {
    expect(validateEvalInput({ ...valid, title: '   ' }).ok).toBe(false)
    expect(validateEvalInput(null).ok).toBe(false)
  })
})

describe('lifecycle', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('draft', 'generating')).toBe(true)
    expect(canTransition('ready', 'voting')).toBe(true)
    expect(canTransition('voting', 'closed')).toBe(true)
    expect(canTransition('draft', 'voting')).toBe(false)
    expect(canTransition('closed', 'voting')).toBe(false)
    expect(canTransition('voting', 'generating')).toBe(false)
  })
  it('freezes once voting opens', () => {
    expect(isFrozen('ready')).toBe(false)
    expect(isFrozen('voting')).toBe(true)
    expect(isFrozen('closed')).toBe(true)
  })
  it('derives post-generation status', () => {
    expect(statusAfterGeneration(['done', 'done'])).toBe('ready')
    expect(statusAfterGeneration(['done', 'failed'])).toBe('needs_attention')
    expect(statusAfterGeneration(['done', 'pending'])).toBe('generating')
  })
})

describe('pairs', () => {
  it('3 models × 8 prompts = 24 canonical pairs, 2 models × 8 = 8', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`)
    expect(buildPairs(ids, 3)).toHaveLength(24)
    expect(buildPairs(ids, 2)).toHaveLength(8)
    expect(buildPairs(ids, 3).every((p) => p.a < p.b)).toBe(true)
  })
  it('labels are anonymous letters', () => {
    expect(anonymousLabels(3)).toEqual(['Model A', 'Model B', 'Model C'])
  })
})

describe('orientation and outcome mapping', () => {
  it('is deterministic per voter and pair', () => {
    expect(isFlipped('u1', 'pair1')).toBe(isFlipped('u1', 'pair1'))
  })
  it('flips roughly half of pairs', () => {
    const flips = Array.from({ length: 1000 }, (_, i) => isFlipped('voter', `pair${i}`)).filter(Boolean).length
    expect(flips).toBeGreaterThan(400)
    expect(flips).toBeLessThan(600)
  })
  it('maps presented choice back to canonical outcome', () => {
    expect(toOutcome('left', false)).toBe('a')
    expect(toOutcome('right', false)).toBe('b')
    expect(toOutcome('left', true)).toBe('b')
    expect(toOutcome('right', true)).toBe('a')
    expect(toOutcome('tie', true)).toBe('tie')
    expect(toOutcome('both_bad', false)).toBe('both_bad')
  })
})

describe('pickNextPair', () => {
  it('prefers least-reviewed pairs and skips ones already voted', () => {
    const counts = new Map([['p1', 3], ['p2', 0], ['p3', 1]])
    expect(pickNextPair(['p1', 'p2', 'p3'], counts, new Set(), 'u')).toBe('p2')
    expect(pickNextPair(['p1', 'p2', 'p3'], counts, new Set(['p2']), 'u')).toBe('p3')
  })
  it('returns null when the voter has done every pair', () => {
    expect(pickNextPair(['p1'], new Map(), new Set(['p1']), 'u')).toBeNull()
  })
})

describe('computeStandings', () => {
  const labels = ['Model A', 'Model B', 'Model C']
  it('counts wins, losses, ties and both-bad separately', () => {
    const rows = computeStandings(labels, [
      { labelA: 'Model A', labelB: 'Model B', outcome: 'a' },
      { labelA: 'Model A', labelB: 'Model C', outcome: 'a' },
      { labelA: 'Model B', labelB: 'Model C', outcome: 'tie' },
      { labelA: 'Model A', labelB: 'Model B', outcome: 'both_bad' },
    ])
    const a = rows.find((r) => r.label === 'Model A')!
    expect(a).toMatchObject({ wins: 2, losses: 0, ties: 0, bothBad: 1, decisiveVotes: 2, decisiveWinRate: 1 })
    const b = rows.find((r) => r.label === 'Model B')!
    expect(b).toMatchObject({ wins: 0, losses: 1, ties: 1, bothBad: 1, decisiveWinRate: 0 })
    expect(rows[0].label).toBe('Model A')
  })
  it('is order-independent', () => {
    const votes = [
      { labelA: 'Model A', labelB: 'Model B', outcome: 'a' as const },
      { labelA: 'Model B', labelB: 'Model C', outcome: 'b' as const },
      { labelA: 'Model A', labelB: 'Model C', outcome: 'tie' as const },
    ]
    expect(computeStandings(labels, votes)).toEqual(computeStandings(labels, [...votes].reverse()))
  })
  it('reports null win rate with no decisive votes and ignores unknown labels', () => {
    const rows = computeStandings(labels, [{ labelA: 'Model X', labelB: 'Model A', outcome: 'a' }])
    expect(rows.every((r) => r.decisiveWinRate === null)).toBe(true)
  })
})

describe('validateImportMatrix', () => {
  it('accepts a full matrix and trims cells', () => {
    const r = validateImportMatrix([[' a ', 'b'], ['c', 'd']], 2, 2)
    expect(r.ok && r.value).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('rejects wrong shape and empty cells', () => {
    expect(validateImportMatrix([['a', 'b']], 2, 2).ok).toBe(false)
    expect(validateImportMatrix([['a'], ['c', 'd']], 2, 2).ok).toBe(false)
    expect(validateImportMatrix([['a', '  '], ['c', 'd']], 2, 2).ok).toBe(false)
    expect(validateImportMatrix('nope', 2, 2).ok).toBe(false)
  })
})
