/**
 * BlindBench invariants, exercised with two real signed-in users against the
 * local runtime. Uses the free "import answers" path so the suite never spends
 * AI credits.
 *
 *   owner  — creates an eval, imports answers, opens/closes voting
 *   voter  — votes blind
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts: npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin')

async function call<T = unknown>(page: Page, name: string, params: Record<string, unknown>) {
  const tok = await page.request.post('/api/auth/token', { headers: { 'Content-Type': 'application/json' }, data: {} })
  const { token } = (await tok.json()) as { token?: string }
  expect(token, 'session token').toBeTruthy()
  const res = await page.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data: params })
  return (await res.json()) as { success: boolean; data?: T; error?: string }
}

const MODELS = ['claude-haiku-4-5', 'gpt-6-luna']

test('blind voting lifecycle: freeze, one vote per pair, no model ids before reveal', async ({ users }) => {
  test.setTimeout(120_000)
  const [owner, voter] = await users(2)
  await Promise.all([owner.page.goto('/home'), voter.page.goto('/home')])

  // ── owner sets up an eval with imported answers (no credits) ──
  const created = await call<{ evalId: string }>(owner.page, 'createEval', {
    title: `spec ${Date.now()}`, guidance: 'Prefer correct', prompts: ['Prompt one', 'Prompt two'], models: MODELS,
  })
  expect(created.success, created.error).toBe(true)
  const evalId = created.data!.evalId

  // a voter can't drive the owner's lifecycle
  expect((await call(voter.page, 'importAnswers', { evalId, answers: [['x', 'y'], ['x', 'y']] })).success).toBe(false)

  // a non-admin can't spend credits
  const gen = await call(owner.page, 'startGeneration', { evalId })
  expect(gen.success).toBe(false)
  expect(gen.error).toMatch(/owner or an admin/i)

  const imported = await call(owner.page, 'importAnswers', { evalId, answers: [['A1 answer', 'B1 answer'], ['A2 answer', 'B2 answer']] })
  expect(imported.success, imported.error).toBe(true)

  // voting isn't open yet
  expect((await call(voter.page, 'nextPair', { evalId })).data).toBeNull()
  expect((await call(voter.page, 'openVoting', { evalId })).success).toBe(false)

  const opened = await call<{ pairs: number }>(owner.page, 'openVoting', { evalId })
  expect(opened.success, opened.error).toBe(true)
  expect(opened.data!.pairs).toBe(2)

  // frozen: no more imports once voting is open
  expect((await call(owner.page, 'importAnswers', { evalId, answers: [['x', 'y'], ['x', 'y']] })).success).toBe(false)

  // ── voter gets a blind pair: no model ids, no labels ──
  const first = await call<{ pairId: string; left: string; right: string }>(voter.page, 'nextPair', { evalId })
  expect(first.success, first.error).toBe(true)
  const payload = JSON.stringify(first.data)
  for (const m of MODELS) expect(payload).not.toContain(m)
  expect(payload).not.toMatch(/Model [AB]/)
  expect(payload).not.toMatch(/answer[AB]Id|contestant/i)

  // reveal is refused while voting
  expect((await call(voter.page, 'getReveal', { evalId })).success).toBe(false)

  // invalid input is refused
  expect((await call(voter.page, 'castVote', { evalId, pairId: first.data!.pairId, choice: 'banana' })).success).toBe(false)

  // ── duplicate votes: two concurrent submissions on the same pair → exactly one lands ──
  const [v1, v2] = await Promise.all([
    call(voter.page, 'castVote', { evalId, pairId: first.data!.pairId, choice: 'left' }),
    call(voter.page, 'castVote', { evalId, pairId: first.data!.pairId, choice: 'right' }),
  ])
  expect([v1.success, v2.success].filter(Boolean)).toHaveLength(1)
  const again = await call(voter.page, 'castVote', { evalId, pairId: first.data!.pairId, choice: 'tie' })
  expect(again.success).toBe(false)
  expect(again.error).toMatch(/already voted/i)

  // the next pair is a different one; after it, the voter is done
  const second = await call<{ pairId: string }>(voter.page, 'nextPair', { evalId })
  expect(second.data!.pairId).not.toBe(first.data!.pairId)
  expect((await call(voter.page, 'castVote', { evalId, pairId: second.data!.pairId, choice: 'both_bad' })).success).toBe(true)
  expect((await call(voter.page, 'nextPair', { evalId })).data).toBeNull()

  // ── only the owner closes; votes after close are refused; reveal works ──
  expect((await call(voter.page, 'closeVoting', { evalId })).success).toBe(false)
  expect((await call(owner.page, 'closeVoting', { evalId })).success).toBe(true)
  expect((await call(voter.page, 'castVote', { evalId, pairId: second.data!.pairId, choice: 'left' })).success).toBe(false)

  const reveal = await call<{ contestants: { modelId: string }[]; rows: { a: number; b: number; tie: number; bothBad: number }[] }>(voter.page, 'getReveal', { evalId })
  expect(reveal.success, reveal.error).toBe(true)
  expect(reveal.data!.contestants.map((c) => c.modelId).sort()).toEqual([...MODELS].sort())
  const totals = reveal.data!.rows.reduce((t, r) => t + r.a + r.b + r.tie + r.bothBad, 0)
  expect(totals).toBe(2) // one per pair, the concurrent duplicate never landed
})

test('anonymous callers are refused', async ({ request }) => {
  const res = await request.post('/api/actions/createEval', { data: { title: 'x', prompts: ['p'], models: MODELS } })
  expect([401, 403]).toContain(res.status())
})
