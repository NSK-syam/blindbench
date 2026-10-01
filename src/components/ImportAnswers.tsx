import { useState } from 'react'
import { Button, Textarea, useToast } from '@/components/ui'
import { callAction } from '../lib/api'
import { validateImportMatrix } from '../lib/domain'
import type { ContestantData, PromptData } from '../types'

type Row<T> = { recordId: string; data: T }

/** Paste existing answers instead of generating them (no credits used). */
export function ImportAnswers({ evalId, prompts, contestants, onCancel }: {
  evalId: string; prompts: Row<PromptData>[]; contestants: Row<ContestantData>[]; onCancel: () => void
}) {
  const { error: toastError, success } = useToast()
  const [cells, setCells] = useState<string[][]>(() => prompts.map(() => contestants.map(() => '')))
  const [busy, setBusy] = useState(false)
  const check = validateImportMatrix(cells, prompts.length, contestants.length)

  async function save() {
    if (!check.ok) return
    setBusy(true)
    try {
      await callAction('importAnswers', { evalId, answers: check.value })
      success('Answers imported')
    } catch (err) {
      toastError('Import failed', err instanceof Error ? err.message : undefined)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Paste each model’s answer. Columns use the anonymous labels; the mapping above tells you which model is which.
        Imported answers are marked as imported wherever results are shown.
      </p>
      {prompts.map((p, i) => (
        <div key={p.recordId} className="rounded-lg border border-border p-3">
          <p className="mb-2 line-clamp-2 text-sm font-medium">{i + 1}. {p.data.text}</p>
          <div className="grid gap-2 md:grid-cols-3">
            {contestants.map((c, j) => (
              <Textarea
                key={c.recordId} rows={4} aria-label={`Prompt ${i + 1}, ${c.data.label}`} placeholder={c.data.label}
                value={cells[i]?.[j] ?? ''}
                onChange={(e) => setCells((m) => m.map((row, r) => (r === i ? row.map((v, k) => (k === j ? e.target.value : v)) : row)))}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{check.ok ? 'All answers filled.' : check.error}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={!check.ok || busy} loading={busy} onClick={() => void save()}>Import answers</Button>
        </div>
      </div>
    </div>
  )
}
