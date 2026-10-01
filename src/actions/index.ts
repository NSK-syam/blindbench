import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { evalActions } from '../server/eval-actions'

export const actions: Record<string, ActionHandler<Env>> = {
  ...evalActions,
}
