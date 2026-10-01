/**
 * Background-job dispatcher, invoked by AppJobRoom (worker.ts).
 * Jobs are enqueued only by server actions (clients cannot enqueue; see the
 * authorizeWrite policy on AppJobRoom).
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { runGenerateJob } from './server/generate'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === 'generate') return runGenerateJob(job, ctx, env)
  throw new Error(`Unknown job type: ${job.type}`)
}
