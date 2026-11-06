// Declarative platform recipe. A recipe describes only the UI path for one
// platform (open -> conversation -> input -> send -> verify); the watch
// pipeline, guard and state machine stay generic and are shared by every
// platform. Adding a new app means adding one YAML file, not core code.

export interface RecipeSelector {
  text?: string
  desc?: string
  resourceId?: string
  className?: string
  // When true, string fields above are compiled as regular expressions.
  regex?: boolean
  // Any "{key}" token inside a field is replaced with the matching runtime
  // context value before matching, e.g. text: "{peer}" clicks the live peer.
}

export type RecipeStepType =
  | 'open_app'
  | 'wait_for'
  | 'tap'
  | 'input'
  | 'send'
  | 'press_key'
  | 'verify'

export interface RecipeStep {
  action: RecipeStepType
  selector?: RecipeSelector
  // Literal text for input, or the context key (e.g. "reply") when `from` set.
  value?: string
  // Read the input value from the execution context under this key.
  from?: string
  key?: 'back' | 'home' | 'recents' | 'enter'
  timeoutMs?: number
}

export interface PlatformRecipe {
  platform: string
  packageName: string
  displayName: string
  steps: RecipeStep[]
}

// Runtime variables handed to a recipe execution.
export interface RecipeContext {
  [key: string]: string
}
