/**
 * BlindBench collections.
 *
 * Write path: every row here is created or changed ONLY by server actions /
 * the generation job (they run as the app and enforce the lifecycle). Clients
 * get read access at most, so the browser can never skip a lifecycle check,
 * claim a vote for someone else, or edit an answer after voting opens.
 *
 * Blinding: anything that links an anonymous label to a real model id
 * (`contestants`) or that would let a voter fetch answers outside the pair
 * flow (`answers`, `pairs`) is readable only by the eval's owner. Voters see
 * evals, prompts, and votes, none of which carry a model id.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const NO_ACCESS: RolePermissions = { read: false, create: false, update: false, delete: false }
const READ_ONLY_ALL: RolePermissions = { read: true, create: false, update: false, delete: false }
const READ_OWN_ONLY: RolePermissions = { read: 'own', create: false, update: false, delete: false }

/** Readable by any signed-in user (voters need it); never client-writable. */
const signedInReadable = {
  viewer: NO_ACCESS,
  member: READ_ONLY_ALL,
  admin: READ_ONLY_ALL,
}

/** Owner-only reads (even other admins can't peek at another owner's mapping). */
const ownerReadable = {
  viewer: NO_ACCESS,
  member: READ_OWN_ONLY,
  admin: READ_OWN_ONLY,
}

const text = (name: string, extra: Record<string, unknown> = {}) => ({ name, storage: 'text' as const, interpretation: 'plain' as const, ...extra })
const num = (name: string, extra: Record<string, unknown> = {}) => ({ name, storage: 'number' as const, interpretation: 'plain' as const, ...extra })
const json = (name: string) => ({ name, storage: 'text' as const, interpretation: { kind: 'json' as const } })

export const evalsSchema: CollectionSchema = {
  name: 'evals',
  columns: [
    text('title', { required: true }),
    text('guidance'),
    text('status', { required: true }), // EvalStatus
    text('ownerId', { required: true, immutable: true }),
    json('labels'), // ['Model A', 'Model B', ...] — anonymous, safe for everyone
    text('answerSource'), // '' | 'generated' | 'imported' — shown so imported runs are never presented as live generation
    num('promptCount'),
    num('pairCount'),
    num('openedAt'),
    num('closedAt'),
  ],
  ownerField: 'ownerId',
  permissions: signedInReadable,
}

/** label ↔ real model. The only place a model id lives. Owner-only. */
export const contestantsSchema: CollectionSchema = {
  name: 'contestants',
  columns: [
    text('evalId', { required: true, immutable: true }),
    text('ownerId', { required: true, immutable: true }),
    num('index', { required: true }),
    text('label', { required: true }),
    text('modelId', { required: true }),
  ],
  ownerField: 'ownerId',
  permissions: ownerReadable,
}

export const promptsSchema: CollectionSchema = {
  name: 'prompts',
  columns: [
    text('evalId', { required: true, immutable: true }),
    num('index', { required: true }),
    text('text', { required: true }),
    num('excluded'), // 1 when the owner removed it from every model's comparison set
  ],
  permissions: signedInReadable,
}

export const answersSchema: CollectionSchema = {
  name: 'answers',
  columns: [
    text('evalId', { required: true, immutable: true }),
    text('ownerId', { required: true, immutable: true }),
    text('promptId', { required: true }),
    text('contestantId', { required: true }),
    text('status', { required: true }), // pending | done | failed
    text('text'),
    text('error'), // owner-only; may name the provider, so never shown to voters
    num('latencyMs'),
    num('attempts'),
  ],
  ownerField: 'ownerId',
  permissions: ownerReadable,
}

/** Canonical comparisons, built when voting opens. Owner-only (they hold answer ids). */
export const pairsSchema: CollectionSchema = {
  name: 'pairs',
  columns: [
    text('evalId', { required: true, immutable: true }),
    text('ownerId', { required: true, immutable: true }),
    text('promptId', { required: true }),
    text('answerAId', { required: true }),
    text('answerBId', { required: true }),
    text('labelA', { required: true }),
    text('labelB', { required: true }),
  ],
  ownerField: 'ownerId',
  permissions: ownerReadable,
}

/**
 * One immutable vote per (pair, voter), enforced by the RecordRoom's
 * composite uniqueness check on every write. Readable by signed-in users so
 * the standings are derived live from the same rows (no separate tally that
 * could drift). Rows carry anonymous labels, never model ids.
 */
export const votesSchema: CollectionSchema = {
  name: 'votes',
  columns: [
    text('evalId', { required: true, immutable: true }),
    text('pairId', { required: true, immutable: true }),
    text('voterId', { required: true, immutable: true }),
    text('labelA', { required: true, immutable: true }),
    text('labelB', { required: true, immutable: true }),
    text('outcome', { required: true, immutable: true }), // a | b | tie | both_bad
  ],
  uniqueOn: ['pairId', 'voterId'],
  ownerField: 'voterId',
  permissions: signedInReadable,
}

export const blindbenchSchemas = [
  evalsSchema,
  contestantsSchema,
  promptsSchema,
  answersSchema,
  pairsSchema,
  votesSchema,
]
