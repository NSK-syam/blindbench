import { useCallback, useEffect, useState } from 'react'
import { Button, useToast } from '@/components/ui'
import { callAction } from '../lib/api'
import type { PresentedChoice } from '../lib/domain'
import type { PresentedPair } from '../types'

type State = { kind: 'loading' } | { kind: 'done' } | { kind: 'error'; message: string } | { kind: 'pair'; pair: PresentedPair }

const CHOICES: Array<{ choice: PresentedChoice; label: string; key: string }> = [
  { choice: 'left', label: 'Left is better', key: '1' },
  { choice: 'right', label: 'Right is better', key: '2' },
  { choice: 'tie', label: 'Tie', key: '3' },
  { choice: 'both_bad', label: 'Both bad', key: '4' },
]

export function VotePanel({ evalId, onActivity }: { evalId: string; onActivity?: (mode: 'voting' | 'idle') => void }) {
  const { error: toastError } = useToast()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const pair = await callAction<PresentedPair | null>('nextPair', { evalId })
      setState(pair ? { kind: 'pair', pair } : { kind: 'done' })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load a comparison' })
    }
  }, [evalId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { onActivity?.(state.kind === 'pair' ? 'voting' : 'idle') }, [state.kind, onActivity])

  const vote = useCallback(async (choice: PresentedChoice) => {
    if (state.kind !== 'pair' || sending) return
    setSending(true)
    try {
      await callAction('castVote', { evalId, pairId: state.pair.pairId, choice })
    } catch (err) {
      // "already voted" is harmless (double-submit, second tab); anything else is worth surfacing.
      const msg = err instanceof Error ? err.message : ''
      if (!/already voted/i.test(msg)) toastError('Vote not recorded', msg)
    } finally {
      setSending(false)
      void load()
    }
  }, [evalId, state, sending, load, toastError])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const c = CHOICES.find((x) => x.key === e.key)
      if (c) void vote(c.choice)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vote])

  if (state.kind === 'loading') return <Panel><p className="text-sm text-muted-foreground">Loading the next comparison…</p></Panel>
  if (state.kind === 'error') return <Panel><p className="text-sm text-destructive">{state.message}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>Try again</Button></Panel>
  if (state.kind === 'done') return <Panel><p className="font-medium">You’ve reviewed every comparison.</p><p className="text-sm text-muted-foreground">Results stay anonymous until the owner closes voting.</p></Panel>

  const { pair } = state
  return (
    <Panel>
      <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>Comparison {pair.done + 1} of {pair.total}</span>
        <span>Keys: 1 left · 2 right · 3 tie · 4 both bad</span>
      </div>
      <div className="mb-4 rounded-lg bg-muted/50 p-4">
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Prompt</p>
        <p className="whitespace-pre-wrap text-sm">{pair.prompt}</p>
        {pair.guidance && <p className="mt-3 text-xs text-muted-foreground"><span className="font-medium">Judge by:</span> {pair.guidance}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Answer side="Left" text={pair.left} />
        <Answer side="Right" text={pair.right} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CHOICES.map((c) => (
          <Button key={c.choice} variant={c.choice === 'left' || c.choice === 'right' ? 'default' : 'outline'} disabled={sending} onClick={() => void vote(c.choice)}>
            {c.label} <kbd className="ml-1 text-xs opacity-60">{c.key}</kbd>
          </Button>
        ))}
      </div>
    </Panel>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section aria-label="Vote" className="rounded-xl border border-border p-5">{children}</section>
}

function Answer({ side, text }: { side: string; text: string }) {
  return (
    <article className="flex max-h-[28rem] flex-col rounded-lg border border-border">
      <h3 className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{side}</h3>
      <div className="overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">{text}</div>
    </article>
  )
}
