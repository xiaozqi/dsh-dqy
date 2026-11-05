// LIVE autonomy run: real adapters on the real phone + real DeepSeek
// decisions + real policy grading. The fish genuinely browses feeds, signs
// in, posts QQ moments and sends DMs it decides to send (user-approved
// whitelist). Forbidden/money actions still stop for confirm (logged).
// Key is never echoed. Log written to data/voice-test/autonomy-live.log.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
import { AdapterRegistry } from '../lib/application/adapters/adapter-registry.js'
import { AutonomyLoop } from '../lib/application/autonomy/autonomy-loop.js'
import { DiaryWriter } from '../lib/application/autonomy/diary-writer.js'
import { DefaultAutonomyPolicy } from '../lib/application/autonomy/default-autonomy-policy.js'
import { QqService } from '../lib/application/apps/qq.service.js'
import { DouyinService } from '../lib/application/apps/douyin.service.js'
import { GameService } from '../lib/application/apps/game.service.js'
import { BilibiliAdapter } from '../lib/application/apps/bilibili.adapter.js'
import { WeiboAdapter } from '../lib/application/apps/weibo.adapter.js'
import { XhsAdapter } from '../lib/application/apps/xiaohongshu.adapter.js'
import { AlipayAdapter } from '../lib/application/apps/alipay.adapter.js'
import { PriorityTapPolicy } from '../lib/application/apps/game-policy.js'
import { Config } from '../lib/index.js'

const ROUNDS = Number(process.env.AUTONOMY_ROUNDS ?? 6)
const FALLBACK_GAP_MS = Number(process.env.AUTONOMY_GAP_MS ?? 60000)
const out = resolve('data/voice-test/autonomy-live.log')
mkdirSync(resolve('data/voice-test'), { recursive: true })
const truncate = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s)
const log = []
const say = (...a) => {
  const line = new Date().toISOString() + ' ' + a.map(String).join(' ')
  log.push(line)
  try {
    writeFileSync(out, line + '\n', { flag: 'a' })
  } catch {}
}

async function main() {
  const cfg = Config()
  const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const dataDir = resolve('data')
  const key = (JSON.parse(readFileSync(resolve(dataDir, 'secrets.local.json'), 'utf8')).deepseekApiKey || '').trim()
  if (!key) throw new Error('no deepseekApiKey in data/secrets.local.json')
  say('llm =', cfg.llmModel, 'key=' + key.slice(0, 6) + '…' + key.slice(-4))
  say('policy auto =', JSON.stringify(cfg.autonomy.autoActions))
  say('policy forbidden =', JSON.stringify(cfg.autonomy.forbiddenActions))

  const adbPath = process.env.ADB_PATH || cfg.adbPath
  const adb = new AdbClient(adbPath, cfg.deviceSerial || undefined)
  const device = new AndroidDevice(adb, resolve(dataDir, 'uiprobe'))
  const memory = new JsonMemory(resolve(dataDir, 'memory.json'))
  const llm = new HttpLlm({ baseUrl: cfg.llmBaseUrl, apiKey: key, model: cfg.llmModel, timeoutMs: cfg.llmTimeoutMs ?? 30000 })

  const vision = new PythonVision(cfg.pythonPath, resolve(packageRoot, 'resources/python/vision_worker.py'), cfg.visionThreshold)
  const u2 = new Uiautomator2Driver(cfg.pythonPath, resolve(packageRoot, 'resources/python/u2_worker.py'), adbPath, cfg.deviceSerial, resolve(dataDir, 'u2'))
  const adbUi = new AdbUiDriver(device)
  let activeScreenshot = async () => ''
  const visionUi = new VisionUiDriver(vision, resolve(packageRoot, 'assets/templates'), () => activeScreenshot())
  const driver = new FallbackUiDriver({ primary: u2, fallback: adbUi, vision: visionUi })
  activeScreenshot = async () => {
    const obs = await driver.observe()
    return obs.screenshotPath
  }

  // Voice is parked (user shelved the voice module); a no-op stub keeps the
  // QQ adapter constructible while never emitting audio.
  const voiceStub = {
    speak: async (t) => ({ ok: true, text: t, path: '' }),
    playFile: async () => ({ ok: true }),
  }

  const qq = new QqService(driver, llm, memory, voiceStub)
  const douyin = new DouyinService(driver, memory)
  const game = new GameService(driver, vision, resolve(packageRoot, 'assets/templates'), new PriorityTapPolicy([]))
  const bilibili = new BilibiliAdapter(driver, memory)
  const weibo = new WeiboAdapter(driver, memory)
  const xhs = new XhsAdapter(driver, memory)
  const alipay = new AlipayAdapter(driver, memory)
  const registry = new AdapterRegistry()
  registry.register(qq)
  registry.register(douyin)
  registry.register(game)
  registry.register(bilibili)
  registry.register(weibo)
  registry.register(xhs)
  registry.register(alipay)
  say('registered apps =', registry.list().map(a => `${a.id}(${[...a.capabilities].join(',')})`).join(' '))

  const policy = new DefaultAutonomyPolicy({
    guardEnabled: cfg.autonomy.guardEnabled,
    autoActions: cfg.autonomy.autoActions,
    forbiddenActions: cfg.autonomy.forbiddenActions,
  })

  const signals = {
    async collect() {
      const all = await memory.recent(40)
      const lines = all.slice(-6).map(h => `${h.kind}: ${truncate(h.content, 200)}`)
      const strategies = all
        .filter(r => r.kind === 'strategy')
        .slice(-3)
        .map(r => `strategy: ${truncate(r.content, 160)}`)
      const diary = all
        .filter(r => r.kind === 'diary')
        .slice(-1)
        .map(r => `my diary: ${truncate(r.content, 240)}`)
      return {
        notifications: [],
        now: new Date().toISOString(),
        memory: [...strategies, ...diary, ...lines],
      }
    },
  }

  const loop = new AutonomyLoop({
    memory,
    llm,
    registry,
    signals,
    policy,
    confirm: {
      async confirmRequired(decision, reason) {
        say('CONFIRM (not executed):', `${decision.app}/${decision.capability}/${decision.method} :: ${reason}`)
      },
    },
    diary: new DiaryWriter({ llm, memory }),
  })

  await device.connect()
  say('device connected')

  let executed = 0
  let confirmed = 0
  let idle = 0
  let skipped = 0
  for (let i = 1; i <= ROUNDS; i++) {
    say(`--- round ${i}/${ROUNDS} ---`)
    const r = await loop.runOnce()
    if (r.decision) say('decision =', JSON.stringify(r.decision))
    say('tick =', JSON.stringify({ decided: r.decided, executed: r.executed, confirmed: r.confirmed, skipped: r.skipped, error: r.error }))
    if (r.executed) executed++
    if (r.confirmed) confirmed++
    if (r.decision?.intent === 'idle') idle++
    if (r.skipped) skipped++
    // Respect the LLM's self-reported wake interval (clamped by policy), else gap.
    // min/max are env-overridable so an observation run stays responsive even
    // when the LLM reports a long nextWakeMs.
    const minWake = Number(process.env.AUTONOMY_MIN_MS ?? cfg.autonomy.minWakeMs)
    const maxWake = Number(process.env.AUTONOMY_MAX_MS ?? cfg.autonomy.maxWakeMs)
    const rawNext = r.nextWakeMs ?? r.decision?.nextWakeMs
    const next = typeof rawNext === 'number' && Number.isFinite(rawNext)
      ? Math.min(maxWake, Math.max(minWake, rawNext))
      : FALLBACK_GAP_MS
    say('next wake =', next, 'ms')
    if (i < ROUNDS) await new Promise(res => setTimeout(res, next))
  }

  say('--- summary ---')
  say(`rounds=${ROUNDS} executed=${executed} confirmed=${confirmed} idle=${idle} skipped=${skipped}`)
  say('AUTONOMY_LIVE_OK')
}

main().then(() => {
  console.log(log.join('\n'))
}).catch(err => {
  say('AUTONOMY_LIVE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  console.log(log.join('\n'))
  process.exitCode = 1
})
