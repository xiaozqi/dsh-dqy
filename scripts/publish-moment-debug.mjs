// Direct QQ publishMoment probe: same real driver chain as the live runner,
// times a single publishMoment call without any LLM decision.
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AdbClient } from '../lib/infrastructure/adb/adb-client.js'
import { AndroidDevice } from '../lib/infrastructure/adb/android-device.js'
import { JsonMemory } from '../lib/infrastructure/memory/json-memory.js'
import { HttpLlm } from '../lib/infrastructure/llm/http-llm.js'
import { PythonVision } from '../lib/infrastructure/vision/python-vision.js'
import { Uiautomator2Driver } from '../lib/infrastructure/drivers/uiautomator2-driver.js'
import { AdbUiDriver } from '../lib/infrastructure/drivers/adb-ui-driver.js'
import { VisionUiDriver } from '../lib/infrastructure/drivers/vision-ui-driver.js'
import { FallbackUiDriver } from '../lib/infrastructure/drivers/fallback-ui-driver.js'
import { QqService } from '../lib/application/apps/qq.service.js'
import { Config } from '../lib/index.js'

const cfg = Config()
const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const dataDir = resolve('data')
const key = (JSON.parse(readFileSync(resolve(dataDir, 'secrets.local.json'), 'utf8')).deepseekApiKey || '').trim()

const adb = new AdbClient(cfg.adbPath, cfg.deviceSerial || undefined)
const device = new AndroidDevice(adb, resolve(dataDir, 'uiprobe'))
const memory = new JsonMemory(resolve(dataDir, 'memory.json'))
const llm = new HttpLlm({ baseUrl: cfg.llmBaseUrl, apiKey: key, model: cfg.llmModel, timeoutMs: cfg.llmTimeoutMs ?? 30000 })

const vision = new PythonVision(cfg.pythonPath, resolve(packageRoot, 'resources/python/vision_worker.py'), cfg.visionThreshold)
const u2 = new Uiautomator2Driver(cfg.pythonPath, resolve(packageRoot, 'resources/python/u2_worker.py'), cfg.adbPath, cfg.deviceSerial, resolve(dataDir, 'u2'))
const adbUi = new AdbUiDriver(device)
let activeScreenshot = async () => ''
const visionUi = new VisionUiDriver(vision, resolve(packageRoot, 'assets/templates'), () => activeScreenshot())
const driver = new FallbackUiDriver({ primary: u2, fallback: adbUi, vision: visionUi })
activeScreenshot = async () => {
  const obs = await driver.observe()
  return obs.screenshotPath
}

await device.connect()
console.log('device connected, lastUsed=', driver.lastUsed)

const voiceStub = {
  speak: async (t) => ({ ok: true, text: t, path: '' }),
  playFile: async () => ({ ok: true }),
}
const qq = new QqService(driver, llm, memory, voiceStub)

const t0 = Date.now()
try {
  const result = await qq.publishMoment({ text: 'debug-probe' })
  console.log('RESULT ok=', result.ok, 'detail=', JSON.stringify(result.detail))
} catch (err) {
  console.log('THREW:', err && err.message, '| stack:', err && err.stack && err.stack.split('\n').slice(0, 3).join(' '))
}
console.log('ELAPSED_MS=', Date.now() - t0)
console.log('foreground=', await driver.foregroundApp())
console.log('lastUsed=', driver.lastUsed)
