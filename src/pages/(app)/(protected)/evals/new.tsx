import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Label, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '../../../../lib/api'
import { LIMITS, MODEL_CHOICES, validateEvalInput } from '../../../../lib/domain'

const DEFAULT_MODELS = ['claude-haiku-4-5', 'gpt-6-luna', 'gpt-oss-120b']

export default function NewEvalPage() {
  const nav = useNavigate()
  const { error: toastError } = useToast()
  const [title, setTitle] = useState('')
  const [guidance, setGuidance] = useState('')
  const [prompts, setPrompts] = useState<string[]>(['', ''])
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS)
  const [busy, setBusy] = useState(false)

  const check = validateEvalInput({ title, guidance, prompts, models })

  function toggleModel(id: string) {
    setModels((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= LIMITS.maxModels ? m : [...m, id]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!check.ok) return
    setBusy(true)
    try {
      const { evalId } = await callAction<{ evalId: string }>('createEval', check.value as unknown as Record<string, unknown>)
      nav(`/e/${evalId}`)
    } catch (err) {
      toastError('Couldn’t create eval', err instanceof Error ? err.message : undefined)
      setBusy(false)
    }
  }

  const filled = prompts.filter((p) => p.trim()).length

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold">New eval</h1>
        <p className="text-sm text-muted-foreground">
          Up to {LIMITS.maxPrompts} prompts and {LIMITS.maxModels} models. Answers are generated once, then frozen when voting opens.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} maxLength={LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} placeholder="Support replies: refunds and billing" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="guidance">What should voters judge? <span className="text-muted-foreground">(optional, shown to voters)</span></Label>
        <Textarea id="guidance" value={guidance} maxLength={LIMITS.guidanceMax} onChange={(e) => setGuidance(e.target.value)} placeholder="Prefer the answer that is correct, specific, and would need the fewest edits before sending." />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Models <span className="text-muted-foreground">({models.length} selected, {LIMITS.minModels}–{LIMITS.maxModels})</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODEL_CHOICES.map((m) => {
            const on = models.includes(m.id)
            const full = !on && models.length >= LIMITS.maxModels
            return (
              <button
                type="button" key={m.id} onClick={() => toggleModel(m.id)} disabled={full} aria-pressed={on}
                className={cn('rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                  on ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/40')}
              >
                <span className="font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.provider}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">Voters never see these names until you close voting. Models get random anonymous labels.</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Prompts <span className="text-muted-foreground">({filled}/{LIMITS.maxPrompts})</span></legend>
        {prompts.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Textarea
              aria-label={`Prompt ${i + 1}`} value={p} maxLength={LIMITS.promptMax} rows={2}
              onChange={(e) => setPrompts((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={i === 0 ? 'A customer asks: “I was charged twice this month, what do I do?”' : 'Another prompt'}
            />
            {prompts.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPrompts((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove prompt ${i + 1}`}>Remove</Button>
            )}
          </div>
        ))}
        {prompts.length < LIMITS.maxPrompts && (
          <Button type="button" variant="outline" size="sm" onClick={() => setPrompts((ps) => [...ps, ''])}>Add prompt</Button>
        )}
      </fieldset>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">{check.ok ? `${check.value.prompts.length * check.value.models.length} answers will be generated.` : check.error}</p>
        <Button type="submit" disabled={!check.ok || busy} loading={busy}>Create eval</Button>
      </div>
    </form>
  )
}
