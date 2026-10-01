import { useMemo } from 'react'
import { useQuery } from 'deepspace'
import { computeStandings } from '../lib/domain'
import type { EvalData, VoteData } from '../types'

/** Live, order-independent standings derived from the vote rows themselves. */
export function Standings({ evalId, data }: { evalId: string; data: EvalData }) {
  const { records, status } = useQuery<VoteData>('votes', { where: { evalId }, limit: 2000 })
  const votes = records.map((r) => r.data)
  const rows = useMemo(() => computeStandings(data.labels ?? [], votes), [data.labels, votes])
  const voters = new Set(votes.map((v) => v.voterId)).size
  const covered = new Set(votes.map((v) => v.pairId)).size

  return (
    <section aria-labelledby="standings" className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="standings" className="text-lg font-semibold">Standings</h2>
        <p className="text-xs text-muted-foreground">
          {votes.length} votes · {voters} voters · {covered}/{data.pairCount} comparisons reviewed
        </p>
      </div>
      {status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading votes…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-2 pr-4">Model</th><th className="pr-4">Wins</th><th className="pr-4">Losses</th><th className="pr-4">Ties</th><th className="pr-4">Both bad</th><th>Decisive win rate</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="py-2 pr-4 font-medium">{r.label}</td>
                  <td className="pr-4 tabular-nums">{r.wins}</td>
                  <td className="pr-4 tabular-nums">{r.losses}</td>
                  <td className="pr-4 tabular-nums">{r.ties}</td>
                  <td className="pr-4 tabular-nums">{r.bothBad}</td>
                  <td className="min-w-40 tabular-nums">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(r.decisiveWinRate ?? 0) * 100}%` }} />
                      </div>
                      <span>{r.decisiveWinRate === null ? '—' : `${Math.round(r.decisiveWinRate * 100)}%`}</span>
                      <span className="text-xs text-muted-foreground">({r.wins}/{r.decisiveVotes})</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Descriptive counts from this group’s votes, not a statistical ranking. Win rate counts only votes where one side won; ties and “both bad” are shown separately.
      </p>
    </section>
  )
}
