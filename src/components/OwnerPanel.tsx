import { useState } from 'react'
import { useJobs, useQuery } from 'deepspace'
import { Button, ConfirmModal, useToast } from '@/components/ui'
import { SCOPE_ID } from '../constants'
import { callAction } from '../lib/api'
import { findModel } from '../lib/domain'
import type { AnswerData, ContestantData, EvalData, PromptData } from '../types'
import { ImportAnswers } from './ImportAnswers'

/**
 * Owner-only controls. The `contestants` and `answers` queries return rows only
 * for the eval's owner (RBAC 'own'), so this panel shows nothing useful to
 * anyone else even if rendered.
 */
export function OwnerPanel({ evalId, data }: { evalId: string; data: EvalData }) {
  const { error: toastError, success } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null)
  const [importing, setImporting] = useState(false)
  const prompts = useQuery<PromptData>('prompts', { where: { evalId }, limit: 50 })
  const contestants = useQuery<ContestantData>('contestants', { where: { evalId }, limit: 10 })
  const answers = useQuery<AnswerData>('answers', { where: { evalId }, limit: 100 })
  const { jobs } = useJobs<{ evalId: string }>(SCOPE_ID)
  const job = jobs.find((j) => j.payload?.evalId === evalId)

  const promptRows = [...prompts.records].sort((a, b) => a.data.index - b.data.index)
  const cols = [...contestants.records].sort((a, b) => a.data.index - b.data.index)
  const answerAt = (promptId: string, contestantId: string) =>
    answers.records.find((a) => a.data.promptId === promptId && a.data.contestantId === contestantId)
  const failed = answers.records.filter((a) => a.data.status === 'failed' && !promptRows.find((p) => p.recordId === a.data.promptId)?.data.excluded)
  const total = promptRows.length * cols.length

  async function run(name: string, params: Record<string, unknown>, done?: string) {
    setBusy(name)
    try {
      await callAction(name, { evalId, ...params })
      if (done) success(done)
    } catch (err) {
      toastError('Action failed', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const link = typeof window !== 'undefined' ? `${window.location.origin}/e/${evalId}` : ''

  return (
    <section aria-label="Owner controls" className="space-y-4 rounded-xl border border-border bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Owner controls</h2>
        <div className="flex flex-wrap gap-2">
          {data.status === 'draft' && !importing && (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>Import answers</Button>
              <Button loading={busy === 'startGeneration'} onClick={() => void run('startGeneration', {})}>Generate {total} answers</Button>
            </>
          )}
          {data.status === 'needs_attention' && failed.length > 0 && (
            <Button loading={busy === 'retryFailed'} onClick={() => void run('retryFailed', {})}>Retry {failed.length} failed</Button>
          )}
          {data.status === 'ready' && <Button onClick={() => setConfirm('open')}>Open voting</Button>}
          {data.status === 'voting' && (
            <>
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(link); success('Link copied') }}>Copy voter link</Button>
              <Button variant="destructive" onClick={() => setConfirm('close')}>Close voting & reveal</Button>
            </>
          )}
        </div>
      </div>

      {data.status === 'generating' && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>{job?.progressMessage ?? 'Starting…'}</span>
            <span>{Math.round((job?.progress ?? 0) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((job?.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${(job?.progress ?? 0) * 100}%` }} />
          </div>
        </div>
      )}

      {data.status === 'needs_attention' && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
          Some answers failed. Retry them, or exclude the affected prompt so every model is compared on the same set.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Label mapping (only you can see this): {cols.map((c) => `${c.data.label} = ${findModel(c.data.modelId)?.label ?? c.data.modelId}`).join(' · ')}
      </p>

      {data.status === 'draft' && !importing && (
        <p className="text-xs text-muted-foreground">Generating uses the app owner’s DeepSpace credits ({total} model calls). Importing answers you already have is free.</p>
      )}

      {data.status === 'draft' && importing ? (
        <ImportAnswers evalId={evalId} prompts={promptRows} contestants={cols} onCancel={() => setImporting(false)} />
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-2 pr-4">Prompt</th>{cols.map((c) => <th key={c.recordId} className="pr-4">{c.data.label}</th>)}<th /></tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {promptRows.map((p) => (
              <tr key={p.recordId} className={p.data.excluded ? 'opacity-40' : ''}>
                <td className="max-w-xs py-2 pr-4"><p className="line-clamp-3">{p.data.text}</p>{p.data.excluded ? <span className="text-xs">Excluded</span> : null}</td>
                {cols.map((c) => {
                  const a = answerAt(p.recordId, c.recordId)
                  return (
                    <td key={c.recordId} className="max-w-xs py-2 pr-4">
                      {!a ? <span className="text-muted-foreground">—</span>
                        : a.data.status === 'done' ? <details><summary className="cursor-pointer text-emerald-400">Done</summary><p className="mt-1 whitespace-pre-wrap text-xs">{a.data.text}</p></details>
                        : a.data.status === 'failed' ? <span className="text-amber-400" title={a.data.error}>Failed</span>
                        : <span className="text-muted-foreground">Pending</span>}
                    </td>
                  )
                })}
                <td className="py-2">
                  {(data.status === 'needs_attention' || data.status === 'ready') && !p.data.excluded && (
                    <Button variant="ghost" size="sm" loading={busy === 'excludePrompt'} onClick={() => void run('excludePrompt', { promptId: p.recordId })}>Exclude</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <ConfirmModal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'open' ? 'Open voting?' : 'Close voting and reveal models?'}
        description={confirm === 'open'
          ? 'Prompts and answers freeze. Anyone signed in with the link can vote once per comparison.'
          : 'No more votes will be accepted, and everyone with the link will see which model was which.'}
        confirmText={confirm === 'open' ? 'Open voting' : 'Close & reveal'}
        variant={confirm === 'close' ? 'destructive' : 'default'}
        onConfirm={() => { const c = confirm; setConfirm(null); void run(c === 'open' ? 'openVoting' : 'closeVoting', {}, c === 'open' ? 'Voting is open' : 'Voting closed') }}
      />
    </section>
  )
}
