import { randomUUID } from 'node:crypto'
import type { StateStorePort } from '../../domain/ports/state-store.port.js'

// One autonomy action that is waiting for the owner. It is persisted so a
// restart cannot silently drop a request the model already made.
export interface PendingAction {
  id: string
  app: string
  capability: string
  method: string
  args: Record<string, unknown>
  reason: string
  createdAt: number
  expiresAt: number
}

interface ConfirmationState {
  actions: PendingAction[]
}

const STORE_KEY = 'confirmations'
const MAX_PENDING = 50

function actionKey(input: {
  app: string
  capability: string
  method: string
  args: Record<string, unknown>
}): string {
  // Keyed by the action, not by its arguments: the heartbeat asked to browse
  // bilibili with count 3, 5 and 4 on three ticks and filled the inbox with
  // the same decision three times. One pending entry per action is enough for
  // the owner to judge, and approving it runs the arguments it was queued with.
  return `${input.app}/${input.capability}/${input.method}`
}

/**
 * Durable inbox of actions the autonomy loop refused to execute on its own.
 *
 * The model can read it, but only the owner can approve it: approvals are
 * exposed as a slash command, never as a tool, so a prompt-injected model
 * cannot talk itself through the gate it just hit.
 */
export class ConfirmationQueue {
  constructor(
    private readonly store: StateStorePort,
    private readonly ttlMs: number,
  ) {}

  enqueue(input: {
    app: string
    capability: string
    method: string
    args: Record<string, unknown>
    reason: string
  }): PendingAction {
    const now = Date.now()
    const actions = this.prune(this.load(), now)
    // An identical pending action collapses into the existing one, so a
    // repetitive heartbeat cannot flood the inbox.
    const key = actionKey(input)
    const existing = actions.find(item => actionKey(item) === key)
    if (existing) {
      this.save(actions)
      return existing
    }
    const action: PendingAction = {
      id: `cf_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
      app: input.app,
      capability: input.capability,
      method: input.method,
      args: input.args,
      reason: input.reason,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    }
    actions.push(action)
    while (actions.length > MAX_PENDING) {
      actions.shift()
    }
    this.save(actions)
    return action
  }

  list(): PendingAction[] {
    const actions = this.prune(this.load(), Date.now())
    this.save(actions)
    return actions
  }

  /** Remove and return one action, or null when it is gone or expired. */
  take(id: string): PendingAction | null {
    const actions = this.prune(this.load(), Date.now())
    const index = actions.findIndex(item => item.id === id)
    if (index === -1) {
      this.save(actions)
      return null
    }
    const [action] = actions.splice(index, 1)
    this.save(actions)
    return action
  }

  deny(id: string): boolean {
    return this.take(id) !== null
  }

  private load(): PendingAction[] {
    const state = this.store.load<ConfirmationState>(STORE_KEY, {
      actions: [],
    })
    return Array.isArray(state.actions) ? state.actions : []
  }

  private save(actions: PendingAction[]): void {
    this.store.save<ConfirmationState>(STORE_KEY, { actions })
  }

  private prune(actions: PendingAction[], now: number): PendingAction[] {
    return actions.filter(item => item.expiresAt > now)
  }
}
