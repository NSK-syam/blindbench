import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, useToast } from '@/components/ui'
import { callAction } from '../lib/api'
import type { PresentedChoice } from '../lib/domain'
import type { PresentedPair } from '../types'

type State = { kind: 'loading' } | { kind: 'done' } | { kind: 'closed' } | { kind: 'error'; message: string } | { kind: 'pair'; pair: PresentedPair }

const KEYS: Record<string, PresentedChoice> = { '1': 'left', '2': 'right', '3': 'tie', '4': 'both_bad' }

export function VotePanel({ evalId, onActivity }: { evalId: string; onActivity?: (mode: 'voting' | 'idle') => void }) {
  const { error: toastError } = useToast()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [sending, setSending] = useState(false)
  // Synchronous guard: two key presses in one tick both see the stale `sending` state.
  const inFlight = useRef(false)
  // Only the latest load may set state (a "Try again" can overlap the post-vote load).
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setState({ kind: 'loading' })
    try {
      const pair = await callAction<PresentedPair | null>('nextPair', { evalId })
      if (seq === loadSeq.current) setState(pair ? { kind: 'pair', pair } : { kind: 'done' })
    } catch (err) {
      if (seq === loadSeq.current) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load a comparison' })
    }
  }, [evalId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { onActivity?.(state.kind === 'pair' ? 'voting' : 'idle') }, [state.kind, onActivity])
  // The page unmounts this panel when voting closes; don't leave presence stuck on "voting".
  useEffect(() => () => onActivity?.('idle'), [onActivity])

  const vote = useCallback(async (choice: PresentedChoice) => {
    if (state.kind !== 'pair' || inFlight.current) return
    inFlight.current = true
    setSending(true)
    let closed = false
    try {
      await callAction('castVote', { evalId, pairId: state.pair.pairId, choice })
    } catch (err) {
      // "already voted" is harmless (double-submit, second tab); anything else is worth surfacing.
      const msg = err instanceof Error ? err.message : ''
      // nextPair returns null once voting closes, which would read as "you've reviewed every comparison".
      closed = /voting is closed/i.test(msg)
      if (!closed && !/already voted/i.test(msg)) toastError('Vote not recorded', msg)
    } finally {
      inFlight.current = false
      setSending(false)
      if (closed) setState({ kind: 'closed' })
      else void load()
    }
  }, [evalId, state, load, toastError])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A held key auto-repeats and would cast a vote on the next pair as soon as it loads.
      if (e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || t.closest('[role="dialog"]'))) return
      const c = KEYS[e.key]
      if (c) void vote(c)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vote])

  if (state.kind === 'loading') return <Panel><p className="text-sm text-muted-foreground">Loading the next comparison…</p></Panel>
  if (state.kind === 'error') return <Panel><p className="text-sm text-destructive">{state.message}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>Try again</Button></Panel>
  if (state.kind === 'closed') return <Panel><p className="font-medium">Voting has closed.</p><p className="text-sm text-muted-foreground">The owner closed voting before this vote arrived, so it wasn’t counted.</p></Panel>
  if (state.kind === 'done') return <Panel><p className="font-medium">You’ve reviewed every comparison.</p><p className="text-sm text-muted-foreground">Results stay anonymous until the owner closes voting.</p></Panel>

  const { pair } = state
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Comparison <span className="font-medium text-foreground">{pair.done + 1}</span> of {pair.total}</span>
        <span className="hidden sm:inline">Keyboard: 1 left · 2 right · 3 tie · 4 both bad</span>
      </div>
      <div className="mb-5 rounded-lg border border-border bg-muted/60 p-4">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prompt</p>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{pair.prompt}</p>
        {pair.guidance && <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Judge by:</span> {pair.guidance}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Answer side="Left" text={pair.left} keyHint="1" disabled={sending} onPick={() => void vote('left')} />
        <Answer side="Right" text={pair.right} keyHint="2" disabled={sending} onPick={() => void vote('right')} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-muted-foreground">Neither stands out?</span>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => void vote('tie')}>Tie <kbd className="ml-1 text-[10px] opacity-60">3</kbd></Button>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => void vote('both_bad')}>Both bad <kbd className="ml-1 text-[10px] opacity-60">4</kbd></Button>
      </div>
    </Panel>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section aria-label="Vote" className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">{children}</section>
}

function Answer({ side, text, keyHint, disabled, onPick }: { side: 'Left' | 'Right'; text: string; keyHint: string; disabled: boolean; onPick: () => void }) {
  return (
    <article className="flex flex-col rounded-lg border border-border bg-card">
      <h3 className="border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{side} answer</h3>
      <div className="max-h-[26rem] min-h-[7rem] flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">{text}</div>
      <div className="border-t border-border p-3">
        <Button className="w-full" disabled={disabled} onClick={onPick} aria-label={`${side} answer is better`}>
          {side === 'Left' ? '← ' : ''}{side} is better{side === 'Right' ? ' →' : ''}
          <kbd className="ml-1 text-[10px] opacity-60">{keyHint}</kbd>
        </Button>
      </div>
    </article>
  )
}
