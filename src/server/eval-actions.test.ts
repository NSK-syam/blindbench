/**
 * Ordering tests for the vote / close race, against an in-memory stand-in for
 * the RecordRoom tools: upsert-by-id keeps the first createdAt, votes are unique
 * on (pairId, voterId), and every write takes a stamp from a controllable clock.
 */
import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { evalActions } from './eval-actions'

type Row = { recordId: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }
type Hook = (collection: string) => Promise<void> | void

function fakeTools() {
  const store = new Map<string, Map<string, Row>>()
  let ms = Date.parse('2026-10-01T03:00:00.000Z')
  const clock = { frozen: false, advance: (n: number) => { ms += n } }
  const hooks: { beforeCreate?: Hook; afterCreate?: Hook } = {}
  const table = (c: string) => store.get(c) ?? store.set(c, new Map()).get(c)!
  const stamp = () => new Date(clock.frozen ? ms : ++ms).toISOString()
  let ids = 0

  const tools = {
    async create(collection: string, data: Record<string, unknown>, recordId?: string) {
      await hooks.beforeCreate?.(collection)
      const t = table(collection)
      const id = recordId ?? `${collection}-${++ids}`
      if (collection === 'votes' && [...t.values()].some((r) => r.data.pairId === data.pairId && r.data.voterId === data.voterId)) {
        return { success: false, error: `Duplicate: a record with pairId=${data.pairId}, voterId=${data.voterId} already exists in votes` }
      }
      const now = stamp()
      const prev = t.get(id)
      t.set(id, prev ? { ...prev, data: { ...prev.data, ...data }, updatedAt: now } : { recordId: id, data, createdAt: now, updatedAt: now })
      await hooks.afterCreate?.(collection)
      return { success: true, data: { recordId: id } }
    },
    async update(collection: string, recordId: string, data: Record<string, unknown>) {
      const r = table(collection).get(recordId)
      if (!r) return { success: false, error: 'not found' }
      Object.assign(r, { data: { ...r.data, ...data }, updatedAt: stamp() })
      return { success: true, data: { recordId } }
    },
    async remove(collection: string, recordId: string) {
      table(collection).delete(recordId)
      return { success: true, data: { recordId } }
    },
    async get(collection: string, recordId: string) {
      const r = table(collection).get(recordId)
      return r ? { success: true, data: { record: structuredClone(r) } } : { success: false, error: 'not found' }
    },
    async query(collection: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
      const records = [...table(collection).values()]
        .filter((r) => Object.entries(opts.where ?? {}).every(([k, v]) => r.data[k] === v))
        .slice(0, opts.limit)
        .map((r) => structuredClone(r))
      return { success: true, data: { records, count: records.length } }
    },
  }
  return { tools: tools as unknown as ActionTools, table, clock, hooks }
}

const OWNER = 'owner-1'
const VOTER = 'voter-1'

/** An eval already in voting with one pair (two answers on one prompt). */
function setup() {
  const f = fakeTools()
  const put = (c: string, id: string, data: Record<string, unknown>) =>
    f.table(c).set(id, { recordId: id, data, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' })
  put('evals', 'e1', { title: 't', guidance: '', status: 'voting', ownerId: OWNER, labels: ['Model A', 'Model B'], promptCount: 1, pairCount: 1 })
  put('contestants', 'c0', { evalId: 'e1', ownerId: OWNER, index: 0, label: 'Model A', modelId: 'gpt-6-luna' })
  put('contestants', 'c1', { evalId: 'e1', ownerId: OWNER, index: 1, label: 'Model B', modelId: 'claude-haiku-4-5' })
  put('prompts', 'p1', { evalId: 'e1', index: 0, text: 'Prompt', excluded: 0 })
  put('answers', 'p1--c0', { evalId: 'e1', ownerId: OWNER, promptId: 'p1', contestantId: 'c0', status: 'done', text: 'A' })
  put('answers', 'p1--c1', { evalId: 'e1', ownerId: OWNER, promptId: 'p1', contestantId: 'c1', status: 'done', text: 'B' })
  put('pairs', 'e1--p1--01', { evalId: 'e1', ownerId: OWNER, promptId: 'p1', answerAId: 'p1--c0', answerBId: 'p1--c1', labelA: 'Model A', labelB: 'Model B' })

  const run = (name: string, userId: string, params: Record<string, unknown>) =>
    evalActions[name]({ userId, params: { evalId: 'e1', ...params }, tools: f.tools, env: {} } as never) as Promise<{ success: boolean; data?: unknown; error?: string }>
  const vote = () => run('castVote', VOTER, { pairId: 'e1--p1--01', choice: 'tie' })
  const close = () => run('closeVoting', OWNER, {})
  const tally = async () => {
    const r = await run('getReveal', OWNER, {})
    expect(r.success, r.error).toBe(true)
    return (r.data as { rows: Array<{ tie: number }> }).rows[0].tie
  }
  return { ...f, run, vote, close, tally }
}

describe('vote vs close ordering', () => {
  it('rejects and removes a vote written after the owner closed', async () => {
    const s = setup()
    s.hooks.beforeCreate = async (c) => { if (c === 'votes') { s.hooks.beforeCreate = undefined; await s.close() } }
    const r = await s.vote()
    expect(r).toMatchObject({ success: false, error: 'Voting is closed' })
    expect(s.table('votes').size).toBe(0)
    expect(await s.tally()).toBe(0)
  })

  it('keeps a vote written before the close, even if the close lands before castVote re-checks', async () => {
    const s = setup()
    s.hooks.afterCreate = async (c) => { if (c === 'votes') { s.hooks.afterCreate = undefined; await s.close() } }
    expect((await s.vote()).success).toBe(true)
    expect(await s.tally()).toBe(1)
  })

  it('excludes a vote stamped in the same millisecond as the close', async () => {
    const s = setup()
    s.clock.frozen = true
    s.hooks.beforeCreate = async (c) => { if (c === 'votes') { s.hooks.beforeCreate = undefined; await s.close() } }
    expect((await s.vote()).success).toBe(false)
    expect(await s.tally()).toBe(0)
  })

  it('a stale second close cannot move the cutoff past a late vote', async () => {
    const s = setup()
    expect((await s.close()).success).toBe(true)
    // A late vote row lands (cleanup not yet run), then a stale close that read 'voting' re-closes.
    const late = new Date(Date.parse(s.table('closures').get('e1')!.createdAt) + 5).toISOString()
    s.table('votes').set('late', { recordId: 'late', data: { evalId: 'e1', pairId: 'e1--p1--01', voterId: VOTER, labelA: 'Model A', labelB: 'Model B', outcome: 'tie' }, createdAt: late, updatedAt: late })
    s.clock.advance(10)
    s.table('evals').get('e1')!.data.status = 'voting'
    expect((await s.close()).success).toBe(true)
    expect(await s.tally()).toBe(0)
  })

  it('refuses votes and new pairs once a closure exists, whatever the eval status says', async () => {
    const s = setup()
    await s.close()
    s.table('evals').get('e1')!.data.status = 'voting' // e.g. a stale openVoting write
    expect(await s.vote()).toMatchObject({ success: false, error: 'Voting is closed' })
    expect((await s.run('nextPair', VOTER, {})).data).toBeNull()
  })

  it('a stale openVoting cannot reopen a closed eval', async () => {
    const s = setup()
    await s.close()
    s.table('evals').get('e1')!.data.status = 'ready' // the stale request's view
    expect(await s.run('openVoting', OWNER, {})).toMatchObject({ success: false, error: 'Voting already closed' })
  })
})
