import type { EvalStatus, Outcome } from './lib/domain'

export interface EvalData {
  title: string
  guidance: string
  status: EvalStatus
  ownerId: string
  labels: string[]
  promptCount: number
  pairCount: number
  answerSource?: '' | 'generated' | 'imported'
  openedAt?: number
  closedAt?: number
}
export interface ContestantData { evalId: string; ownerId: string; index: number; label: string; modelId: string }
export interface PromptData { evalId: string; index: number; text: string; excluded?: number }
export type AnswerStatus = 'pending' | 'done' | 'failed'
export interface AnswerData {
  evalId: string; ownerId: string; promptId: string; contestantId: string
  status: AnswerStatus; text?: string; error?: string; latencyMs?: number; attempts?: number
}
export interface PairData { evalId: string; ownerId: string; promptId: string; answerAId: string; answerBId: string; labelA: string; labelB: string }
export interface VoteData { evalId: string; pairId: string; voterId: string; labelA: string; labelB: string; outcome: Outcome }

/** What a voter receives for one comparison. No ids beyond the pair, no labels. */
export interface PresentedPair {
  pairId: string
  prompt: string
  guidance: string
  left: string
  right: string
  done: number
  total: number
}

export interface RevealRow {
  promptIndex: number
  prompt: string
  labelA: string
  labelB: string
  modelA: string
  modelB: string
  a: number; b: number; tie: number; bothBad: number
}
export interface RevealData {
  contestants: Array<{ label: string; modelId: string; modelLabel: string }>
  rows: RevealRow[]
}
