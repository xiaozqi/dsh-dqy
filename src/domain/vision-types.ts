import type { Bounds, Point } from './types.js'

export interface TextBlock {
  text: string
  confidence: number
  bounds: Bounds
  center: Point
}

export interface MatchTarget {
  label: string
  template: string
  point: Point
  score: number
}
