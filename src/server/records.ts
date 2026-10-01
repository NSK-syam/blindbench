/**
 * Small typed wrappers over the server-side records APIs (action `tools` and
 * the job's owner context) so the rest of the code never handles raw
 * envelopes or forgets a limit.
 */

import type { ActionTools } from 'deepspace/worker'
import { LIMITS } from '../lib/domain'

export type Envelope<T> = { recordId: string; data: T; createdAt?: string; updatedAt?: string }

/** Hard ceiling for any one query. An eval has ≤ 8 prompts × 3 models, so
 *  only `votes` can approach it; queryAll fails loudly instead of truncating. */
export const QUERY_LIMIT = LIMITS.voteQueryMax

export class ActionError extends Error {}

export async function queryAll<T>(tools: ActionTools, collection: string, where: Record<string, unknown>): Promise<Envelope<T>[]> {
  // `count` is just the number of rows returned, so ask for one extra row to detect truncation.
  const r = await tools.query<Record<string, unknown>>(collection, { where, limit: QUERY_LIMIT + 1 })
  if (!r.success) throw new ActionError(`Could not read ${collection}`)
  const records = r.data.records as unknown as Envelope<T>[]
  if (records.length > QUERY_LIMIT) throw new ActionError(`${collection} result was truncated (over ${QUERY_LIMIT} rows)`)
  return records
}

export async function getOne<T>(tools: ActionTools, collection: string, id: string): Promise<Envelope<T> | null> {
  if (!id || typeof id !== 'string') return null
  const r = await tools.get<Record<string, unknown>>(collection, id)
  if (!r.success) return null
  return r.data.record as unknown as Envelope<T>
}

export async function must<T>(p: Promise<{ success: boolean; data?: T; error?: string }>, what: string): Promise<T> {
  const r = await p
  if (!r.success) throw new ActionError(`${what} failed${r.error ? `: ${r.error}` : ''}`)
  return r.data as T
}
