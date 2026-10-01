import { useCallback, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthProfileReady, usePresenceRoom, useQuery } from 'deepspace'
import { OwnerPanel } from '../../../../components/OwnerPanel'
import { Reveal } from '../../../../components/Reveal'
import { Standings } from '../../../../components/Standings'
import { StatusBadge } from '../../../../components/StatusBadge'
import { VotePanel } from '../../../../components/VotePanel'
import type { EvalData } from '../../../../types'

export default function EvalPage() {
  const { id = '' } = useParams()
  const { user } = useAuthProfileReady({ requireUser: true })
  const { records, status } = useQuery<EvalData>('evals', { limit: 500 })
  const row = records.find((r) => r.recordId === id)
  const { peers, updateState } = usePresenceRoom(`eval:${id}`)
  const onActivity = useCallback((mode: 'voting' | 'idle') => updateState({ mode }), [updateState])
  useEffect(() => { updateState({ mode: 'idle' }) }, [updateState])

  if (status === 'loading') return <p className="p-10 text-sm text-muted-foreground">Loading…</p>
  if (!row) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">Eval not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The link may be wrong, or the eval was removed.</p>
        <Link to="/home" className="mt-4 inline-block text-sm text-primary underline">Back to evals</Link>
      </div>
    )
  }

  const data = row.data
  const isOwner = data.ownerId === user?.id
  const votingNow = peers.filter((p) => p.state?.mode === 'voting')

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/home" className="text-xs text-muted-foreground hover:underline">← Evals</Link>
          <h1 className="mt-1 text-2xl font-semibold">{data.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.labels?.length ?? 0} models · {data.promptCount} prompts{data.pairCount ? ` · ${data.pairCount} comparisons` : ''}
            {data.answerSource === 'imported' && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Imported answers</span>}
            {data.answerSource === 'generated' && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Generated live</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={data.status} />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {peers.length === 0 ? 'Only you here' : `${peers.length + 1} here · ${votingNow.length} voting now`}
          </p>
        </div>
      </header>

      {isOwner && <OwnerPanel evalId={id} data={data} />}

      {data.status === 'voting' && (
        <>
          {isOwner && <p className="text-xs text-muted-foreground">You’ve seen the generated answers, so your own votes aren’t blind. Consider leaving voting to others.</p>}
          <VotePanel evalId={id} onActivity={onActivity} />
        </>
      )}

      {!isOwner && data.status !== 'voting' && data.status !== 'closed' && (
        <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">Voting hasn’t opened yet. This page updates live when it does.</p>
      )}

      {(data.status === 'voting' || data.status === 'closed') && <Standings evalId={id} data={data} closeStamp={data.status === 'closed' ? row.updatedAt : null} />}
      {data.status === 'closed' && <Reveal evalId={id} />}
    </div>
  )
}
