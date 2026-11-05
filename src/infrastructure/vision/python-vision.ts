import { spawn } from 'node:child_process'
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

  private call(command: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.pythonPath,
        [this.workerPath, JSON.stringify(command)],
        { windowsHide: true },
      )
      const outChunks: Buffer[] = []
      const errChunks: Buffer[] = []

      child.stdout.on('data', chunk => outChunks.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)))
      child.on('error', err => {
        reject(
          new VisionError('VISION_NOT_STARTABLE', err.message),
        )
      })
      child.on('close', code => {
        if (code !== 0) {
          reject(
            new VisionError(
              'VISION_PROCESS_FAILED',
              Buffer.concat(errChunks).toString('utf8') ||
                `worker exit ${code}`,
            ),
          )
          return
        }
        let parsed: WorkerResponse
        try {
          parsed = JSON.parse(
            Buffer.concat(outChunks).toString('utf8'),
          ) as WorkerResponse
        } catch (err) {
          reject(
            new VisionError(
              'VISION_BAD_JSON',
              (err as Error).message,
            ),
          )
          return
        }
        if (!parsed.ok) {
          reject(
            new VisionError(
              'VISION_WORKER_ERROR',
              parsed.error ?? 'unknown worker error',
            ),
          )
          return
        }
        resolve(parsed.data)
      })
    })
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
