# BlindBench

Blind A/B comparisons of model answers, voted on by your team.

**Live:** https://blindbench.app.space

An owner writes up to 8 prompts and picks 2–3 models. Answers are generated in
a background job (or pasted in, for free). The owner shares one link; signed-in
teammates see two anonymous answers per prompt, sides shuffled, and pick the
better one, a tie, or "both bad". Standings update live for everyone. Model
names stay hidden until the owner closes voting.

## How it works

```
draft ──generate──▶ generating ──▶ ready ──open──▶ voting ──close──▶ closed
  │                     │                (frozen)            (names revealed)
  └──import answers──▶ ready     needs_attention ◀─ (retry failed / exclude prompt)
```

- **One canonical pair per prompt per model combination** (3 models × 8 prompts = 24).
- **Coverage-first assignment:** each voter gets their least-reviewed eligible pair next.
- **Orientation** (which answer is on the left) is a per-voter hash, recomputed on the
  server when the vote arrives. The browser never tells the server which side was which.
- **Standings are descriptive:** wins, losses, ties, both-bad, and decisive win rate
  with its denominator. No Elo/Bradley–Terry: with a handful of voters and shared
  prompts, a ranking would claim more than the data supports.

## DeepSpace primitives used, and why

| Primitive | Used for |
|---|---|
| **Records + RBAC** (`RecordRoom`, per-collection permissions, `uniqueOn`) | Every collection is read-only to clients; all writes go through server actions. The label → model mapping, answers and pairs are owner-only. `uniqueOn(pairId, voterId)` makes "one vote per comparison" atomic, including concurrent submits. |
| **Server actions** | The only write path. Each one re-checks ownership and the lifecycle state before writing. |
| **Background jobs** (`JobRoom`) | Answer generation outlives the request: 3 calls per tick, `ctx.continue()` between ticks, live progress over WebSocket. Clients cannot enqueue, cancel or retry (`authorizeWrite: () => false`); only owner-checked actions enqueue. |
| **AI** (`createDeepSpaceAI`: Anthropic, OpenAI, Cerebras) | Three providers through the platform proxy, billed to the app owner. No API keys in the app. |
| **Real-time sync + presence** (`useQuery`, `usePresenceRoom`) | Standings are derived live from vote rows; the eval page shows who is here and who is voting. |
| **Auth** | Built-in sign-in; anonymous callers are refused by every action. |

**Deliberately not used:** payments (an internal evaluation tool with no paying users),
file uploads (pasting text covers imports), Yjs/canvas (no co-editing), cron (nothing
recurs), LiveKit (no audio/video).

## Main tradeoff

A **small, auditable comparison workflow with descriptive results**, not a statistically
authoritative benchmark. Caps (8 prompts, 3 models), one pair per prompt and model
combination, frozen answers and plain counts keep every number traceable to a vote row.

## Security model

- Generation spends the app owner's DeepSpace credits, so only the app owner or an admin
  can start or retry it. Anyone signed in can create an eval with **imported** answers
  (free); imported runs are labeled "Imported answers".
- Voters never receive model ids, anonymous labels or answer ids before reveal. The
  orientation key mixes in owner-only answer ids, so a voter can't recompute sides from
  the pair id.
- Closing voting writes an insert-once `closures` row; its timestamp is the cutoff that
  reveal, standings and `castVote` all honor, so a vote racing the close never counts.
- Reads that could exceed the query limit fail loudly instead of silently truncating.

**Known limits:** answer *style* can still hint at which model wrote it. The owner has seen
the answers, so their own votes aren't blind (the UI says so). Anyone signed in with the
link can vote; an invite list is the next step for confidential prompts.

## Run it

```bash
npm install
npx deepspace auth login
npx deepspace dev start          # http://localhost:5173
npx deepspace test run all       # unit + two-user Playwright spec
npx deepspace deploy
```

Key files: `src/lib/domain.ts` (rules, all pure and unit-tested),
`src/server/eval-actions.ts` (every write), `src/server/generate.ts` (the job),
`src/schemas/blindbench-schema.ts` (who can read what), `tests/blindbench.spec.ts`
(lifecycle, blinding and duplicate-vote invariants with two real users).

## What I'd do next

Invite-only evals, an LLM-as-judge pass reporting agreement with human consensus (with
its sample size), CSV import for prompts, and per-voter agreement stats.
