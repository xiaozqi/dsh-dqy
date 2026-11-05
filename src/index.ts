import type { Context } from '@deepseek-ai/cordis'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { AgentLoop } from './application/agent-loop.js'
import { AdapterRegistry } from './application/adapters/adapter-registry.js'
import { PriorityTapPolicy } from './application/apps/game-policy.js'
import { AlipayAdapter } from './application/apps/alipay.adapter.js'
import { BilibiliAdapter } from './application/apps/bilibili.adapter.js'
import { DouyinService } from './application/apps/douyin.service.js'
import { GameService } from './application/apps/game.service.js'
import { QqService } from './application/apps/qq.service.js'
import { WeiboAdapter } from './application/apps/weibo.adapter.js'
import { XhsAdapter } from './application/apps/xiaohongshu.adapter.js'
import { DailyScheduler } from './application/scheduler/daily-scheduler.js'
import { HeartbeatScheduler } from './application/scheduler/heartbeat-scheduler.js'
import { AutonomyLoop } from './application/autonomy/autonomy-loop.js'
import { DiaryWriter } from './application/autonomy/diary-writer.js'
import { AutonomyDriver } from './application/autonomy/autonomy-driver.js'
import { DefaultAutonomyPolicy } from './application/autonomy/default-autonomy-policy.js'
import type {
  AutonomyDecision,
  AutonomySignalBundle,
  AutonomySignalSource,
} from './domain/ports/autonomy.port.js'
import type { LlmPort } from './domain/ports/llm.port.js'
import {
  DedupeFilter,
  ImportanceFilter,
  RuleFilter,
  SemanticFilter,
  WhitelistFilter,
  AppBlocklistFilter,
} from './application/notifications/filters.js'
import { NotificationPipeline } from './application/notifications/pipeline.js'
import { NotificationService } from './application/notifications/notification.service.js'
import { Guardrails } from './application/guardrails.js'
import type { SignInPlan } from './application/tasks/task-types.js'
import { SignInService } from './application/tasks/signin.task.js'
import { DeviceError } from './domain/errors.js'
import { LogcatNotificationSource } from './infrastructure/notifications/logcat-notification-source.js'
import { HttpNotificationSource } from './infrastructure/notifications/http-notification-source.js'
import { ReverseTunnelKeepAlive } from './infrastructure/notifications/reverse-tunnel.js'
import { AdbClient } from './infrastructure/adb/adb-client.js'
import { AndroidDevice } from './infrastructure/adb/android-device.js'
import { resolveDeviceSerial } from './infrastructure/adb/resolve-device.js'
import { AdbUiDriver } from './infrastructure/drivers/adb-ui-driver.js'
import { FallbackUiDriver } from './infrastructure/drivers/fallback-ui-driver.js'
import { Uiautomator2Driver } from './infrastructure/drivers/uiautomator2-driver.js'
import { VisionUiDriver } from './infrastructure/drivers/vision-ui-driver.js'
import { HttpLlm } from './infrastructure/llm/http-llm.js'
import { HostLlm, detectHostLlm } from './infrastructure/llm/host-llm.js'
import { JsonMemory } from './infrastructure/memory/json-memory.js'
import { PythonVision } from './infrastructure/vision/python-vision.js'
import { PythonVoice } from './infrastructure/voice/python-voice.js'
import { RoutedVoice } from './infrastructure/voice/routed-voice.js'
import { VolcTts } from './infrastructure/voice/volc-tts.js'
import { registerCommands } from './interface/commands.js'
import { PERSONA, registerPersona } from './interface/prompt.js'
import { registerTools } from './interface/tools.js'

export const name = 'blue-fat-fish'
export const inject = ['tools']

const stepSchema = z.object({
  kind: z.string().required(),
  target: z.string(),
  value: z.string(),
  durationMs: z.number(),
})

const planSchema = z.object({
  app: z.string().required(),
  appName: z.string().required(),
  successText: z.array(z.string()).default([]),
  steps: z.array(stepSchema).default([]),
})

const scheduleSchema = z.object({
  app: z.string().required(),
  hour: z.number().required(),
  minute: z.number().required(),
  enabled: z.boolean().default(true),
})

// Default junk-notification rules applied when the user does not provide any.
// Conservative keyword list for ad / promo / scam titles; real messages that
// merely mention a word are unlikely to match all of these together.
const defaultJunkRules: {
  pattern: string
  action: 'allow' | 'block'
  caseSensitive: boolean
}[] = [
  { pattern: '广告|推广', action: 'block', caseSensitive: false },
  { pattern: '限时特惠|限时优惠|特惠|大促|秒杀|清仓', action: 'block', caseSensitive: false },
  { pattern: '优惠券|领券|返现', action: 'block', caseSensitive: false },
  { pattern: '贷款|借款|放款|网贷', action: 'block', caseSensitive: false },
  { pattern: '中奖|抽奖|领红包', action: 'block', caseSensitive: false },
  { pattern: '兼职|刷单|日结', action: 'block', caseSensitive: false },
]

export const Config = z.object({
  adbPath: z.string().default('adb'),
  deviceSerial: z.string().default(''),
  llmBaseUrl: z.string().default('https://api.deepseek.com'),
  llmModel: z.string().default('deepseek-chat'),
  apiKey: z.string().default(''),
  llmTimeoutMs: z.number().default(60000),
  dataDir: z.string().default('./data/blue-fat-fish'),
  pythonPath: z.string().default('python'),
  voicePythonPath: z.string().default(''),
  visionThreshold: z.number().default(0.85),
  templateDir: z.string().default(''),
  voice: z.string().default('zh-CN-XiaoxiaoNeural'),
  volcApiKey: z.string().default(''),
  volcAppId: z.string().default(''),
  volcAccessKey: z.string().default(''),
  volcResourceId: z.string().default('seed-tts-2.0'),
  volcSpeaker: z.string().default('zh_female_cancan_mars_bigtts'),
  gptsovitsSrc: z.string().default(''),
  gptsovitsModelsDir: z.string().default(''),
  gptsovitsPythonPath: z.string().default(''),
  allowedApps: z.array(z.string()).default([]),
  forbiddenPackages: z
    .array(z.string())
    .default(['com.android.settings', 'com.android.packageinstaller']),
  maxSteps: z.number().default(40),
  signInPlans: z.array(planSchema).default([]),
  schedules: z.array(scheduleSchema).default([]),
  notifications: z
    .object({
      enabled: z.boolean().default(true),
      httpPort: z.number().default(14123),
      whitelist: z.array(z.string()).default([]),
      blockedApps: z
        .array(z.string())
        .default([
          'com.sina.weibo',
          'com.xingin.xhs',
          'com.phoenix.read',
          'com.smile.gifmaker',
        ]),
      minImportance: z.number().default(2),
      rules: z
        .array(
          z.object({
            pattern: z.string(),
            action: z.union(['allow', 'block']),
            caseSensitive: z.boolean().default(false),
          }),
        )
        .default(defaultJunkRules),
      semanticEnabled: z.boolean().default(false),
      dedupeWindowMs: z.number().default(600000),
    })
    .default({}),
  autonomy: z
    .object({
      enabled: z.boolean().default(true),
      heartbeatMs: z.number().default(30 * 60 * 1000),
      // Scheduling bounds: LLM self-reports are clamped into [min, max];
      // when LLM does not report, fallbackWakeMs is used.
      minWakeMs: z.number().default(5 * 60 * 1000),
      maxWakeMs: z.number().default(120 * 60 * 1000),
      fallbackWakeMs: z.number().default(30 * 60 * 1000),
      // Allow incoming allow-list notifications to trigger an immediate
      // runOnce instead of waiting for the next heartbeat.
      wakeOnEvent: z.boolean().default(true),
      guardEnabled: z.boolean().default(true),
      // User-approved auto whitelist (medium autonomy): browse/like feed,
      // post QQ moments, send DMs, daily sign-in run without human confirm.
      // Money-related actions stay outside this list and thus need confirm.
      autoActions: z
        .array(z.string())
        .default([
          'douyin/feed/browseFeed',
          'qq/moment/publishMoment',
          'message/sendMessage',
          'signin/signIn',
        ]),
      // Outbound images / mentions / comments and passive time sinks.
      forbiddenActions: z
        .array(z.string())
        .default([
          'message/sendImage',
          'social/mention',
          'comment/comment',
          'comment/replyComment',
          'game/runGame',
          'live/watchLive',
        ]),
    })
    .default({}),
})

// Local-only secret fallback: standalone runs reuse the DeepSeek key from
// data/secrets.local.json when the host (DSH) injects no apiKey. The file is
// never committed or logged; DSH-injected config always wins.
function localSecret(file: string): string {
  try {
    const obj = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    return typeof obj.deepseekApiKey === 'string' ? obj.deepseekApiKey : ''
  } catch {
    return ''
  }
}

/**
 * Resolve the adb serial without letting a missing adb break plugin loading.
 *
 * A host that loads the plugin before adb is reachable must still expose the
 * fish tools; the device layer then fails per call with a readable error
 * instead of the whole plugin disappearing.
 */
function resolveSerialOrEmpty(adbPath: string, configured: string): string {
  try {
    return resolveDeviceSerial(adbPath, configured)
  } catch (err) {
    console.warn(
      `[blue-fat-fish] device auto-discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return ''
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function apply(
  ctx: Context,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
): void {
  const dataDir = resolve(config.dataDir)
  const packageRoot = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
  )
  const visionWorker = resolve(
    packageRoot,
    'resources/python/vision_worker.py',
  )
  const voiceWorker = resolve(
    packageRoot,
    'resources/python/voice_worker.py',
  )
  const u2Worker = resolve(
    packageRoot,
    'resources/python/u2_worker.py',
  )
  const templateRoot = resolve(
    config.templateDir ||
      resolve(packageRoot, 'assets/templates'),
  )
  const voiceDir = resolve(dataDir, 'voice')
  mkdirSync(voiceDir, { recursive: true })
  const voicesDir = resolve(dataDir, 'voices')
  mkdirSync(voicesDir, { recursive: true })
  const gptsovitsSrc = resolve(
    config.gptsovitsSrc ||
      resolve(packageRoot, 'vendor/gptsovits-src/GPT-SoVITS-main'),
  )
  const gptsovitsModelsDir = resolve(
    config.gptsovitsModelsDir ||
      resolve(packageRoot, 'vendor/GPT-SoVITS-models'),
  )
  const gptsovitsPythonPath = resolve(
    config.gptsovitsPythonPath ||
      resolve(packageRoot, 'vendor/gptsovits-venv/Scripts/python.exe'),
  )
  const gptsovitsSynthWorker = resolve(
    packageRoot,
    'resources/python/gptsovits_synth.py',
  )

  const serial = resolveSerialOrEmpty(config.adbPath, config.deviceSerial)
  const adb = new AdbClient(config.adbPath, serial || undefined)
  const device = new AndroidDevice(adb, dataDir)
  const memory = new JsonMemory(resolve(dataDir, 'memory.json'))
  const llmApiKey =
    config.apiKey ||
    process.env.DEEPSEEK_API_KEY ||
    localSecret(resolve(dataDir, 'secrets.local.json'))
  // Host model channel first: inside DSH the runtime already owns provider
  // credentials, so the plugin needs no apiKey of its own. Standalone runs
  // (scripts, tests) fall back to the HTTP adapter below.
  const hostLlm = detectHostLlm(ctx)
  const llm: LlmPort =
    hostLlm && !config.apiKey
      ? new HostLlm({
          runtime: hostLlm,
          preferredModel: config.llmModel,
          timeoutMs: config.llmTimeoutMs,
        })
      : new HttpLlm({
          baseUrl: config.llmBaseUrl,
          apiKey: llmApiKey,
          model: config.llmModel,
          timeoutMs: config.llmTimeoutMs,
        })
  const vision = new PythonVision(
    config.pythonPath,
    visionWorker,
    config.visionThreshold,
  )
  const u2 = new Uiautomator2Driver(
    config.pythonPath,
    u2Worker,
    config.adbPath,
    serial,
    resolve(dataDir, 'u2'),
  )
  const adbUi = new AdbUiDriver(device)
  let activeScreenshot: () => Promise<string> = async () => ''
  const visionUi = new VisionUiDriver(
    vision,
    templateRoot,
    () => activeScreenshot(),
  )
  const driver = new FallbackUiDriver({
    primary: u2,
    fallback: adbUi,
    vision: visionUi,
  })
  activeScreenshot = async () => {
    const observation = await driver.observe()
    return observation.screenshotPath
  }
  const voice = new PythonVoice({
    pythonPath: config.voicePythonPath || config.pythonPath,
    workerPath: voiceWorker,
    audioDir: voiceDir,
    defaultVoice: config.voice,
    voicesDir,
    gptsovitsPythonPath,
    gptsovitsSynthWorker,
    gptsovitsSrc,
    gptsovitsModelsDir,
  })
  const volcTts =
    config.volcApiKey || (config.volcAppId && config.volcAccessKey)
      ? new VolcTts({
          apiKey: config.volcApiKey,
          appId: config.volcAppId,
          accessKey: config.volcAccessKey,
          resourceId: config.volcResourceId,
          speaker: config.volcSpeaker,
          audioDir: voiceDir,
        })
      : null
  const routedVoice = new RoutedVoice({
    pythonVoice: voice,
    volcTts,
    voicesDir,
  })
  const guardrails = new Guardrails({
    allowedApps: config.allowedApps,
    forbiddenPackages: config.forbiddenPackages,
    maxSteps: config.maxSteps,
  })
  const loop = new AgentLoop(
    device,
    memory,
    llm,
    guardrails,
    PERSONA,
    routedVoice,
  )
  const signin = new SignInService(
    device,
    memory,
    config.signInPlans as SignInPlan[],
  )
  const qq = new QqService(driver, llm, memory, routedVoice)
  const douyin = new DouyinService(driver, memory)
  const game = new GameService(
    driver,
    vision,
    templateRoot,
    new PriorityTapPolicy([]),
  )
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
  const scheduler = new DailyScheduler({
    plans: config.schedules,
    run: async plan => {
      const planConfig = signin
        .listPlans()
        .find(p => p.app === plan.app)
      if (!planConfig) {
        throw new DeviceError(
          'PLAN_NOT_FOUND',
          `no sign-in plan for ${plan.app}`,
        )
      }
      await signin.run(planConfig)
    },
  })

  scheduler.start()
  ctx.effect(() => () => scheduler.stop())

  const notifDir = resolve(dataDir, 'notifications')
  mkdirSync(notifDir, { recursive: true })
  const httpNotifSource = new HttpNotificationSource(
    config.notifications.httpPort,
    resolve(notifDir, 'received.log'),
  )
  const logcatNotifSource = new LogcatNotificationSource(
    config.adbPath,
    serial,
  )
  const notifTunnel = new ReverseTunnelKeepAlive(
    config.adbPath,
    serial,
  )
  const notifRules = (config.notifications.rules ?? []).map(
    (r: {
      pattern: string
      action: 'allow' | 'block'
      caseSensitive: boolean
    }) => ({
      match: new RegExp(r.pattern, r.caseSensitive ? '' : 'i'),
      action: r.action,
    }),
  )
  const notifPipeline = new NotificationPipeline([
    new WhitelistFilter(new Set<string>(config.notifications.whitelist)),
    new ImportanceFilter(config.notifications.minImportance),
    new AppBlocklistFilter(
      new Set<string>(config.notifications.blockedApps),
    ),
    new RuleFilter(notifRules),
    new SemanticFilter(llm, config.notifications.semanticEnabled),
    new DedupeFilter(config.notifications.dedupeWindowMs),
  ])
  // Forward declaration: NotificationService is constructed before the
  // autonomy driver below; the allow-event callback closes over this slot.
  let autonomyDriver: AutonomyDriver | null = null
  const notifications = new NotificationService(
    [httpNotifSource, logcatNotifSource],
    notifPipeline,
    100,
    httpNotifSource,
    resolve(notifDir, 'cancel.log'),
    () => autonomyDriver?.onAllowEvent(),
  )
  if (config.notifications.enabled) {
    void notifications.start().catch(() => {})
    void notifTunnel.start().catch(() => {})
  }
  ctx.effect(() => () => {
    void notifications.stop()
    notifTunnel.stop()
  })

  // ---- AutonomyLoop: heartbeat -> collect -> LLM decide -> graded act ----
  const autonomySignals: AutonomySignalSource = {
    async collect(): Promise<AutonomySignalBundle> {
      const allowed = notifications
        .recent(20)
        .filter(d => d.action === 'allow')
        .slice(-6)
        .map(d => `${d.event.app}: ${truncate(d.event.title, 120)}`)
      // recent() instead of recall(): keyword recall can silently miss goals
      // that were just seeded (see experience/autonomy-memory-recall-gap).
      const all = await memory.recent(40)
      const memoryLines = all
        .slice(-6)
        .map(h => `${h.kind}: ${truncate(h.content, 200)}`)
      // Digestible long-term context: newest strategies + latest diary.
      const strategies = all
        .filter(r => r.kind === 'strategy')
        .slice(-3)
        .map(r => `strategy: ${truncate(r.content, 160)}`)
      const diary = all.filter(r => r.kind === 'diary').slice(-1)
        .map(r => `my diary: ${truncate(r.content, 240)}`)
      return {
        notifications: allowed,
        now: new Date().toISOString(),
        memory: [...strategies, ...diary, ...memoryLines],
      }
    },
  }
  const autonomyPolicy = new DefaultAutonomyPolicy({
    guardEnabled: config.autonomy.guardEnabled,
    autoActions: config.autonomy.autoActions,
    forbiddenActions: config.autonomy.forbiddenActions,
  })
  const autonomyConfirm = {
    async confirmRequired(
      decision: AutonomyDecision,
      reason: string,
    ): Promise<void> {
      console.warn(
        `[autonomy] CONFIRM required: ${decision.app}/${decision.capability}/${decision.method} :: ${reason}`,
      )
      await memory.remember({
        kind: 'event',
        content: `autonomy confirm pending: ${decision.app}/${decision.capability}/${decision.method} | reason=${decision.reason}`,
        tags: ['autonomy', 'confirm-pending'],
      })
    },
  }
  const autonomyLoop = new AutonomyLoop({
    memory,
    llm,
    registry,
    signals: autonomySignals,
    policy: autonomyPolicy,
    confirm: autonomyConfirm,
    diary: new DiaryWriter({ llm, memory }),
  })
  // Heartbeat fires driver.wake('heartbeat'); driver then re-schedules with a
  // clamped interval derived from the LLM's nextWakeMs self-report.
  const heartbeat = new HeartbeatScheduler({
    initialIntervalMs: config.autonomy.heartbeatMs,
    onTick: () => autonomyDriver?.wake('heartbeat'),
  })
  autonomyDriver = new AutonomyDriver({
    loop: autonomyLoop,
    scheduler: heartbeat,
    config: {
      minWakeMs: config.autonomy.minWakeMs,
      maxWakeMs: config.autonomy.maxWakeMs,
      fallbackWakeMs: config.autonomy.fallbackWakeMs,
      wakeOnEvent: config.autonomy.wakeOnEvent,
    },
  })
  if (config.autonomy.enabled) {
    try {
      autonomyDriver.start()
      ctx.effect(() => () => autonomyDriver?.stop())
    } catch (err) {
      // A failing first tick must not take the plugin (and its tools) down.
      console.warn(
        `[blue-fat-fish] autonomy start failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  registerTools(ctx, {
    loop,
    signin,
    device: driver,
    memory,
    vision,
    voice: routedVoice,
    qq,
    douyin,
    game,
    scheduler,
    adapters: registry,
    adbPath: config.adbPath,
    deviceSerial: serial,
    notifications,
  })
  registerCommands(ctx, {
    loop,
    signin,
    device: driver,
    memory,
    vision,
    voice: routedVoice,
    qq,
    douyin,
    game,
    scheduler,
    adapters: registry,
    adbPath: config.adbPath,
    deviceSerial: serial,
    notifications,
  })
  registerPersona(ctx)
}
