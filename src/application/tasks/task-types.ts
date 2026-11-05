export type StepKind =
  | 'open_app'
  | 'click_text'
  | 'wait'
  | 'press_key'
  | 'input_text'

export interface SignInStep {
  kind: StepKind
  target?: string
  value?: string
  durationMs?: number
}

export interface SignInPlan {
  app: string
  appName: string
  successText: string[]
  steps: SignInStep[]
}
