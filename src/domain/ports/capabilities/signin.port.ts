import type { AdapterResult } from '../../adapter-types.js'

export interface SignInCapability {
  readonly capability: 'signin'
  signIn(): Promise<AdapterResult>
}
