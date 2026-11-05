import type { AdapterResult } from '../../adapter-types.js'

export interface PetCapability {
  readonly capability: 'pet'
  feedPet(): Promise<AdapterResult>
}
