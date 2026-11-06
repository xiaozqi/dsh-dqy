import { ProcessSupervisor } from '../process-supervisor.js'

// OCR runs on every fish_ocr call and template lookup; a wedged python worker
// used to hang the whole tool call. One shared supervisor gives each call a
// deadline and kills the child tree on expiry.
const visionSupervisor = new ProcessSupervisor()
import { VisionError } from '../../domain/errors.js'
import type { VisionPort } from '../../domain/ports/vision.port.js'
import type { Point } from '../../domain/types.js'
import type { MatchTarget, TextBlock } from '../../domain/vision-types.js'

interface RawBlock {
  text: string
  confidence: number
  bounds: [number, number, number, number]
  center: [number, number]
}

interface RawMatch {
  label: string
  template: string
  point: [number, number]
  score: number
}

interface WorkerResponse {
  ok: boolean
  data?: unknown
  error?: string
}

export class PythonVision implements VisionPort {
  constructor(
    private readonly pythonPath: string,
    private readonly workerPath: string,
    private readonly defaultThreshold: number,
  ) {}

  async ocr(screenshotPath: string): Promise<TextBlock[]> {
    const data = (await this.call({
      mode: 'ocr',
      image: screenshotPath,
    })) as RawBlock[]
    return data.map(toTextBlock)
  }

  async findTemplate(
    screenshotPath: string,
    templatePath: string,
    threshold = this.defaultThreshold,
  ): Promise<Point | null> {
    const point = (await this.call({
      mode: 'find_template',
      image: screenshotPath,
      template: templatePath,
      threshold,
    })) as [number, number] | null
    return point ? { x: point[0], y: point[1] } : null
  }

  async matchTemplates(
    screenshotPath: string,
    templates: Array<{ label: string; path: string }>,
    threshold = this.defaultThreshold,
  ): Promise<MatchTarget[]> {
    const raw = (await this.call({
      mode: 'match_templates',
      image: screenshotPath,
      templates,
      threshold,
    })) as RawMatch[]
    return raw.map(t => ({
      label: t.label,
      template: t.template,
      score: t.score,
      point: { x: t.point[0], y: t.point[1] },
    }))
  }

  async locateText(
    screenshotPath: string,
    text: string,
  ): Promise<Point | null> {
    const point = (await this.call({
      mode: 'locate_text',
      image: screenshotPath,
      text,
    })) as [number, number] | null
    return point ? { x: point[0], y: point[1] } : null
  }

  private async call(command: Record<string, unknown>): Promise<unknown> {
    const result = await visionSupervisor.run(
      this.pythonPath,
      [this.workerPath, JSON.stringify(command)],
      { timeoutMs: 30000 },
    )
    if (result.timedOut) {
      throw new VisionError(
        'VISION_TIMEOUT',
        'vision worker exceeded 30s and was killed',
      )
    }
    if (result.code !== 0) {
      throw new VisionError(
        'VISION_PROCESS_FAILED',
        result.stderr || `worker exit ${result.code}`,
      )
    }
    let parsed: WorkerResponse
    try {
      parsed = JSON.parse(result.stdout) as WorkerResponse
    } catch (err) {
      throw new VisionError('VISION_BAD_JSON', (err as Error).message)
    }
    if (!parsed.ok) {
      throw new VisionError(
        'VISION_WORKER_ERROR',
        parsed.error ?? 'unknown worker error',
      )
    }
    return parsed.data
  }
}

function toTextBlock(raw: RawBlock): TextBlock {
  const [left, top, right, bottom] = raw.bounds
  const [cx, cy] = raw.center
  return {
    text: raw.text,
    confidence: raw.confidence,
    bounds: { left, top, right, bottom },
    center: { x: cx, y: cy },
  }
}
