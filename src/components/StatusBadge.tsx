import type { EvalStatus } from '../lib/domain'
import { cn } from '@/lib/utils'

const STYLE: Record<EvalStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-muted text-muted-foreground' },
  generating: { label: 'Generating', cls: 'bg-blue-500/15 text-blue-400' },
  needs_attention: { label: 'Needs attention', cls: 'bg-amber-500/15 text-amber-400' },
  ready: { label: 'Ready to vote', cls: 'bg-emerald-500/15 text-emerald-400' },
  voting: { label: 'Voting open', cls: 'bg-violet-500/15 text-violet-300' },
  closed: { label: 'Closed', cls: 'bg-muted text-foreground' },
}

export function StatusBadge({ status }: { status: EvalStatus }) {
  const s = STYLE[status] ?? STYLE.draft
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', s.cls)}>{s.label}</span>
}
