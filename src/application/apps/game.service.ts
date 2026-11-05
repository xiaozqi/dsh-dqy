import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AdapterResult,
  AdapterTodo,
  CapabilityId,
} from '../../domain/adapter-types.js'
import { failResult, okResult } from '../../domain/adapter-types.js'
import type { GameRun, GameStep } from '../../domain/app-types.js'
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js'
import type { GameCapability, GameInput } from '../../domain/ports/capabilities/game.port.js'
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js'
import type { VisionPort } from '../../domain/ports/vision.port.js'
import { sleep } from '../support/wait-for.js'
import type { GamePolicy } from './game-policy.js'

export interface GameOptions {
  game: string
  rounds?: number
  threshold?: number
  settleMs?: number
  finishLabels?: string[]
}

const DEFAULT_FINISH_LABELS = ['success', 'finish', 'close']

export class GameService implements AppAdapter, GameCapability {
  readonly id = 'game'
  readonly displayName = '游戏'
  readonly packageName = ''
  readonly capabilities: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
    'game',
  ])
  readonly todos: readonly AdapterTodo[] = [
    {
      capability: 'game',
      feature: 'puzzle solver policies',
      note: 'not implemented: board-level solving needs a custom GamePolicy (e.g. match-3 grid analysis)',
    },
  ]

  declare readonly capability: never

  constructor(
    private readonly driver: UiDriverPort,
    private readonly vision: VisionPort,
    private readonly templateRoot: string,
    private readonly policy: GamePolicy,
  ) {}

  async initialize(): Promise<void> {}

  async runGame(input: GameInput): Promise<AdapterResult> {
    try {
      const run = await this.run({
        game: input.game,
        rounds: input.rounds,
        threshold: input.threshold,
      })
      return okResult(
        `game ${run.game} finished after ${run.rounds} rounds`,
        {
          game: run.game,
          rounds: run.rounds,
          finishedAt: run.finishedAt,
          steps: run.steps.length,
        },
      )
    } catch (err) {
      return failResult(
        `game failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async run(options: GameOptions): Promise<GameRun> {
    const rounds = options.rounds ?? 30
    const threshold = options.threshold ?? 0.85
    const settleMs = options.settleMs ?? 1200
    const finishLabels =
      options.finishLabels ?? DEFAULT_FINISH_LABELS

    await this.driver.connect()
    const steps: GameStep[] = []
    let emptyStreak = 0

    for (let round = 1; round <= rounds; round++) {
      const observation = await this.driver.observe()
      const templates = this.listTemplates(options.game)
      const matches = await this.vision.matchTemplates(
        observation.screenshotPath,
        templates,
        threshold,
      )

      if (matches.some(m => finishLabels.includes(m.label))) {
        steps.push({
          action: 'finish',
          reason: 'finish template matched',
        })
        break
      }

      const step = this.policy.decide(
        round,
        matches,
        observation,
      )
      if (!step) {
        emptyStreak++
        if (emptyStreak >= 3) {
          steps.push({
            action: 'finish',
            reason: 'no template matched for 3 rounds',
          })
          break
        }
        await this.driver.pressKey('back')
        await sleep(settleMs)
        continue
      }

      emptyStreak = 0
      steps.push(step)
      await this.execute(step)
      await sleep(settleMs)
    }

    return {
      game: options.game,
      rounds: steps.length,
      steps,
      finishedAt: new Date().toISOString(),
    }
  }

  private listTemplates(
    game: string,
  ): Array<{ label: string; path: string }> {
    const dir = join(this.templateRoot, game)
    return readdirSync(dir)
      .filter(file => file.toLowerCase().endsWith('.png'))
      .map(file => ({
        label: file.replace(/\.png$/i, ''),
        path: join(dir, file),
      }))
  }

  private async execute(step: GameStep): Promise<void> {
    if (step.action === 'tap' && step.point) {
      await this.driver.tap(step.point)
    } else if (step.action === 'long_press' && step.point) {
      await this.driver.longPress(step.point, 1200)
    } else if (step.action === 'press_key' && step.target) {
      await this.driver.pressKey(
        step.target as 'back' | 'home' | 'recents' | 'enter',
      )
    }
  }
}
