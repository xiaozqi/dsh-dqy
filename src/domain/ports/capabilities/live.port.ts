import type { AdapterResult } from '../../adapter-types.js'

export interface WatchLiveInput {
  anchor?: string
  durationMs?: number
}

export interface LiveCapability {
  readonly capability: 'live'
  watchLive(input: WatchLiveInput): Promise<AdapterResult>
}
