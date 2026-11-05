export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface UiNode {
  text: string
  desc: string
  resourceId: string
  className: string
  packageName: string
  bounds: Bounds
  clickable: boolean
  enabled: boolean
  children: UiNode[]
}

export interface Observation {
  screenshotPath: string
  foregroundApp: string
  screenSize: Size
  roots: UiNode[]
  capturedAt: string
}

export type ActionName =
  | 'tap'
  | 'long_press'
  | 'swipe'
  | 'input_text'
  | 'press_key'
  | 'open_app'
  | 'wait'
  | 'remember'
  | 'recall'
  | 'speak'
  | 'finish'

export interface AgentAction {
  thought: string
  name: ActionName
  args: Record<string, unknown>
}

export interface RunResult {
  goal: string
  completed: boolean
  summary: string
  steps: number
}

export type MemoryKind =
  | 'fact'
  | 'event'
  | 'task'
  | 'lesson'
  | 'goal'
  | 'diary'
  | 'strategy'

export interface MemoryRecord {
  id: string
  kind: MemoryKind
  content: string
  tags: string[]
  createdAt: string
}

export interface TaskRecord {
  app: string
  name: string
  lastStatus: 'success' | 'failed' | 'skipped'
  lastRunAt: string
  detail: string
}
