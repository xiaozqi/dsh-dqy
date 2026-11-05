import type { GameStep } from '../../domain/app-types.js'
import type { MatchTarget } from '../../domain/vision-types.js'
import type { Observation } from '../../domain/types.js'

export interface GamePolicy {
  decide(
    round: number,
    matches: MatchTarget[],
    observation: Observation,
  ): GameStep | null
}

export class PriorityTapPolicy implements GamePolicy {
  constructor(private readonly priority: string[] = []) {}

  decide(
    _round: number,
    matches: MatchTarget[],
  ): GameStep | null {
    if (matches.length === 0) return null
    const ordered = [...matches].sort((a, b) => {
      const rankDiff = this.rank(a.label) - this.rank(b.label)
      if (rankDiff !== 0) return rankDiff
      return b.score - a.score
    })
    const target = ordered[0]
    return {
      action: 'tap',
      target: target.label,
      point: target.point,
      reason:
        `highest priority match: ${target.label} ` +
        `(${target.score.toFixed(2)})`,
    }
  }

  private rank(label: string): number {
    const index = this.priority.indexOf(label)
    return index === -1 ? this.priority.length + 1 : index
  }
}
