import { Link } from 'react-router-dom'
import { useAuthProfileReady, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import type { EvalData } from '../../types'

export default function HomePage() {
  const { isSignedIn, user } = useAuthProfileReady({ requireUser: true })
  const { records, status } = useQuery<EvalData>('evals', { orderBy: 'createdAt', orderDir: 'desc', limit: 200 })

  if (!isSignedIn) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Sign in to see evals</h1>
        <p className="text-sm text-muted-foreground">BlindBench evals are shared by link with signed-in teammates.</p>
      </div>
    )
  }

  const mine = records.filter((r) => r.data.ownerId === user?.id)
  const shared = records.filter((r) => r.data.ownerId !== user?.id && (r.data.status === 'voting' || r.data.status === 'closed'))

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Evals</h1>
          <p className="text-sm text-muted-foreground">Blind A/B comparisons of model answers, voted on by your team.</p>
        </div>
        <Link to="/evals/new"><Button>New eval</Button></Link>
      </div>

      {status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {status === 'error' && <p className="text-sm text-destructive">Couldn’t load evals. Refresh to try again.</p>}

      {status === 'ready' && (
        <>
          <Section title="Your evals" empty="You haven’t created an eval yet." rows={mine} />
          <Section title="Shared with you" empty="Nothing open for voting right now." rows={shared} />
        </>
      )}
    </div>
  )
}

function Section({ title, empty, rows }: { title: string; empty: string; rows: { recordId: string; data: EvalData }[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.recordId}>
              <Link to={`/e/${r.recordId}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.data.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.data.labels?.length ?? 0} models · {r.data.promptCount} prompts
                    {r.data.pairCount ? ` · ${r.data.pairCount} comparisons` : ''}
                  </p>
                </div>
                <StatusBadge status={r.data.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
