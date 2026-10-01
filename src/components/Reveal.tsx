import { useEffect, useState } from 'react'
import { callAction } from '../lib/api'
import type { RevealData } from '../types'

export function Reveal({ evalId }: { evalId: string }) {
  const [state, setState] = useState<{ data?: RevealData; error?: string }>({})
  useEffect(() => {
    callAction<RevealData>('getReveal', { evalId }).then((data) => setState({ data }), (e) => setState({ error: e instanceof Error ? e.message : 'Could not load results' }))
  }, [evalId])

  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>
  if (!state.data) return <p className="text-sm text-muted-foreground">Loading results…</p>
  const { contestants, rows } = state.data
  return (
    <section aria-labelledby="reveal" className="rounded-xl border border-border p-5">
      <h2 id="reveal" className="mb-3 text-lg font-semibold">Revealed</h2>
      <ul className="mb-5 flex flex-wrap gap-2 text-sm">
        {contestants.map((c) => <li key={c.label} className="rounded-full bg-muted px-3 py-1"><span className="font-medium">{c.label}</span> = {c.modelLabel}</li>)}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-2 pr-4">Prompt</th><th className="pr-4">Comparison</th><th className="pr-4">A wins</th><th className="pr-4">B wins</th><th className="pr-4">Tie</th><th>Both bad</th></tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="max-w-xs py-2 pr-4"><p className="line-clamp-2">{r.prompt}</p></td>
                <td className="pr-4 text-xs">{r.labelA} ({r.modelA}) vs {r.labelB} ({r.modelB})</td>
                <td className="pr-4 tabular-nums">{r.a}</td><td className="pr-4 tabular-nums">{r.b}</td>
                <td className="pr-4 tabular-nums">{r.tie}</td><td className="tabular-nums">{r.bothBad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
