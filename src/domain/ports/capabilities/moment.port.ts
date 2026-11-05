import type { AdapterResult } from '../../adapter-types.js'

export interface MomentInput {
  text: string
  // Alias accepted from LLM decisions (some models emit content instead of
  // text); adapters should prefer text and fall back to content.
  content?: string
  visibleTo?: string
}

export interface MomentCapability {
  readonly capability: 'moment'
  publishMoment(input: MomentInput): Promise<AdapterResult>
}
