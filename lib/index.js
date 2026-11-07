import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { AgentLoop } from './application/agent-loop.js';
import { AdapterRegistry } from './application/adapters/adapter-registry.js';
import { PriorityTapPolicy } from './application/apps/game-policy.js';
import { BilibiliAdapter } from './application/apps/bilibili.adapter.js';
import { DouyinService } from './application/apps/douyin.service.js';
import { GameService } from './application/apps/game.service.js';
import { QqService } from './application/apps/qq.service.js';
import { WeiboAdapter } from './application/apps/weibo.adapter.js';
import { XhsAdapter } from './application/apps/xiaohongshu.adapter.js';
import { DailyScheduler } from './application/scheduler/daily-scheduler.js';
import { HeartbeatScheduler } from './application/scheduler/heartbeat-scheduler.js';
import { AutonomyLoop } from './application/autonomy/autonomy-loop.js';
import { DiaryWriter } from './application/autonomy/diary-writer.js';
import { AutonomyDriver } from './application/autonomy/autonomy-driver.js';
import { DefaultAutonomyPolicy } from './application/autonomy/default-autonomy-policy.js';
import { DedupeFilter, ImportanceFilter, RuleFilter, SemanticFilter, WhitelistFilter, AppBlocklistFilter, } from './application/notifications/filters.js';
import { NotificationPipeline } from './application/notifications/pipeline.js';
import { NotificationService } from './application/notifications/notification.service.js';
import { Guardrails } from './application/guardrails.js';
import { SignInService } from './application/tasks/signin.task.js';
import { AdapterError, DeviceError, PolicyBlockedError } from './domain/errors.js';
import { LogcatNotificationSource } from './infrastructure/notifications/logcat-notification-source.js';
import { HttpNotificationSource } from './infrastructure/notifications/http-notification-source.js';
import { QqNotificationWatcher } from './infrastructure/notifications/qq-notification-watcher.js';
import { ReverseTunnelKeepAlive } from './infrastructure/notifications/reverse-tunnel.js';
import { AdbClient } from './infrastructure/adb/adb-client.js';
import { AndroidDevice } from './infrastructure/adb/android-device.js';
import { resolveDeviceSerial } from './infrastructure/adb/resolve-device.js';
import { resolveAdbPath } from './infrastructure/adb/resolve-adb.js';
import { resolveScrcpyPath } from './infrastructure/mirror/resolve-scrcpy.js';
import { ScrcpyMirror } from './infrastructure/mirror/scrcpy-mirror.js';
import { FileMirrorConfigStore } from './infrastructure/mirror/file-mirror-config.js';
import { NodeShell } from './infrastructure/node-shell.js';
import { createFileLogger } from './infrastructure/file-logger.js';
import { CordisWebServer, } from './infrastructure/web/cordis-web-server.js';
import { MirrorHttpController } from './infrastructure/web/mirror-http.controller.js';
import { MirrorPanelService } from './application/mirror/mirror-panel.service.js';
import { AdbUiDriver } from './infrastructure/drivers/adb-ui-driver.js';
import { FallbackUiDriver } from './infrastructure/drivers/fallback-ui-driver.js';
import { Uiautomator2Driver } from './infrastructure/drivers/uiautomator2-driver.js';
import { SerialDevice } from './infrastructure/device/serial-device.js';
import { VisionUiDriver } from './infrastructure/drivers/vision-ui-driver.js';
import { HttpLlm } from './infrastructure/llm/http-llm.js';
import { HostLlm, detectHostLlm } from './infrastructure/llm/host-llm.js';
import { JsonMemory } from './infrastructure/memory/json-memory.js';
import { PythonVision } from './infrastructure/vision/python-vision.js';
import { PythonVoice } from './infrastructure/voice/python-voice.js';
import { RoutedVoice } from './infrastructure/voice/routed-voice.js';
import { VolcTts } from './infrastructure/voice/volc-tts.js';
import { registerCommands } from './interface/commands.js';
import { PERSONA, registerPersona } from './interface/prompt.js';
import { registerTools } from './interface/tools.js';
import { FileStateStore } from './infrastructure/state/file-state-store.js';
import { OutboundGuard, buildPeerSet } from './application/control/outbound-guard.js';
import { GuardedAdapterRegistry, surfaceFor } from './application/control/guarded-adapters.js';
import { ConfirmationQueue, } from './application/control/confirmation-queue.js';
import { RunMode } from './application/control/run-mode.js';
import { MessageStateStore } from './application/control/message-state-store.js';
import { DmWatchPipeline } from './application/control/dm-watch-pipeline.js';
import { RecipeExecutor } from './application/recipes/recipe-executor.js';
import { RecipeLoader } from './infrastructure/recipes/recipe-loader.js';
import { RecipeDirectMessageSender } from './infrastructure/recipes/recipe-dm-sender.js';
import { DouyinDmSender, DOUYIN_PACKAGE, } from './infrastructure/recipes/douyin-dm-sender.js';
export const name = 'dqy';
// `llm` is injected so `ctx.llm` is populated: without it detectHostLlm()
// returns null and every model call falls back to an HTTP client that has no
// apiKey, which surfaced as "apiKey missing in plugin config".
export const inject = ['tools', 'webServer', 'llm'];
const stepSchema = z.object({
    kind: z.string().required(),
    target: z.string(),
    value: z.string(),
    durationMs: z.number(),
});
const planSchema = z.object({
    app: z.string().required(),
    appName: z.string().required(),
    successText: z.array(z.string()).default([]),
    steps: z.array(stepSchema).default([]),
});
const scheduleSchema = z.object({
    app: z.string().required(),
    hour: z.number().required(),
    minute: z.number().required(),
    enabled: z.boolean().default(true),
});
// Default junk-notification rules applied when the user does not provide any.
// Conservative keyword list for ad / promo / scam titles; real messages that
// merely mention a word are unlikely to match all of these together.
const defaultJunkRules = [
    // ADBKeyBoard posts a 「选择输入法」 notification on every Chinese injection;
    // that is our own noise, not something the owner needs to see or process.
    { pattern: '选择输入法|AdbKeyboard|ADB Keyboard', action: 'block', caseSensitive: false },
    { pattern: '广告|推广', action: 'block', caseSensitive: false },
    { pattern: '限时特惠|限时优惠|特惠|大促|秒杀|清仓', action: 'block', caseSensitive: false },
    { pattern: '优惠券|领券|返现', action: 'block', caseSensitive: false },
    { pattern: '贷款|借款|放款|网贷', action: 'block', caseSensitive: false },
    { pattern: '中奖|抽奖|领红包', action: 'block', caseSensitive: false },
    { pattern: '兼职|刷单|日结', action: 'block', caseSensitive: false },
];
const configSchema = z.object({
    adbPath: z.string().default('adb'),
    scrcpyPath: z.string().default('scrcpy'),
    deviceSerial: z.string().default(''),
    llmBaseUrl: z.string().default('https://api.deepseek.com'),
    llmModel: z.string().default('deepseek-chat'),
    apiKey: z.string().default(''),
    llmTimeoutMs: z.number().default(60000),
    dataDir: z.string().default('./data/dqy'),
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
        .default([
        'com.android.settings',
        'com.android.packageinstaller',
        // Money and payment surfaces stay out of reach even for /fish goals.
        'com.eg.android.AlipayGphone',
        'com.unionpay',
    ]),
    maxSteps: z.number().default(40),
    // Hard deadline for one fish_* tool call. A wedged adb/uiautomator2/python
    // call must fail with a typed timeout instead of hanging the model step.
    toolTimeoutMs: z
        .number()
        .default(180000)
        .description('单个工具调用的硬超时（毫秒）。设备卡住时报超时，而不是一直转圈。'),
    signInPlans: z.array(planSchema).default([]),
    schedules: z.array(scheduleSchema).default([]),
    notifications: z
        .object({
        enabled: z.boolean().default(true),
        httpPort: z.number().default(14123),
        // Loopback only. `adb reverse` forwards the phone to the host loopback,
        // so binding wider has no benefit and lets the LAN forge notifications.
        bindHost: z
            .string()
            .default('127.0.0.1')
            .description('通知监听地址。保持 127.0.0.1：adb reverse 走的就是本机；改成 0.0.0.0 等于让局域网能伪造通知。'),
        // When set, the phone-side bridge must send `x-fish-token: <token>`.
        token: z
            .string()
            .default('')
            .description('可选的共享密钥；设置后手机端桥接必须带 x-fish-token 请求头。'),
        maxBodyBytes: z
            .number()
            .default(65536)
            .description('单条通知的体积上限（字节），超过直接拒绝。'),
        // A filter chain that throws must block, not deliver the event.
        failClosed: z
            .boolean()
            .default(true)
            .description('过滤链出错时是否拦截该通知。默认拦截（关闭等于出错就放行，不建议）。'),
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
            .array(z.object({
            pattern: z.string(),
            action: z.union(['allow', 'block']),
            caseSensitive: z.boolean().default(false),
        }))
            .default(defaultJunkRules),
        semanticEnabled: z.boolean().default(false),
        // Replays arrive within a few seconds; the old 10-minute default also
        // swallowed a friend sending the same short message twice. Message-level
        // idempotency in the reply paths now covers true replays.
        dedupeWindowMs: z.number().default(3000),
    })
        .default({}),
    mirror: z
        .object({
        alwaysOnTop: z.boolean().default(true),
        windowWidth: z.number().default(460),
        turnScreenOff: z.boolean().default(true),
        audio: z.boolean().default(false),
        graceMs: z.number().default(1200),
        reconnect: z.boolean().default(true),
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
        // Nothing is auto-executed by default: every act decision lands in the
        // confirmation queue until the owner whitelists that exact action here.
        // `forbiddenActions` always wins, even if an entry is also listed above.
        autoActions: z
            .array(z.string())
            .default([])
            .description('允许她不经确认就执行的动作（格式 应用/能力/方法）。默认空：所有动作都要你点头。'),
        // Outbound / public or unbounded actions: always require a human.
        forbiddenActions: z
            .array(z.string())
            .default([
            'message/sendMessage',
            'message/sendImage',
            'voice/sendVoiceText',
            'moment/publishMoment',
            'social/mention',
            'comment/comment',
            'comment/replyComment',
            'game/runGame',
            'live/watchLive',
        ])
            .description('永远需要人工确认的动作；优先级高于 autoActions。'),
        // How long a pending confirmation waits before it is silently dropped.
        confirmTtlMs: z
            .number()
            .default(24 * 60 * 60 * 1000)
            .description('待确认动作的有效期（毫秒），过期自动丢弃，默认 24 小时。'),
    })
        .default({}),
    // Watch control: safe defaults (sending disabled, dry run on). These drive
    // the run-mode gate and the hard outbound guard for the DM pipeline.
    control: z
        .object({
        enabled: z.boolean().default(false),
        dryRun: z.boolean().default(true),
        // QQ is not covered by the recipe-based DM pipeline, and a tool is only
        // called when the model asks for it — so nothing answered a QQ message
        // that arrived on its own. This wires the notification to the reply path.
        qqAutoReply: z
            .boolean()
            .default(true)
            .description('QQ 消息通知进来时自动走回复流程（仍需收件人白名单与内容校验）。'),
        // Entries are `${packageName}:${peer}`; an empty list blocks every peer.
        allowedPeers: z
            .array(z.string())
            .default([])
            .description('收件人白名单，格式 "包名:对方名"（如 com.tencent.mobileqq:张三）。空列表 = 谁都不发。'),
        maxLength: z.number().default(500),
        blockUrl: z.boolean().default(true),
        recipeDir: z.string().default(''),
    })
        .default({}),
});
/** Declared with an explicit annotation on purpose: see the note on `Config`. */
/**
 * Declared with an explicit annotation on purpose: the inferred type of a
 * schemastery object references internal cosmokit paths, which TypeScript
 * cannot name in the emitted `lib/index.d.ts` (TS2742). The output side is
 * the hand-written `FishConfig`, so `apply()` is fully typed.
 */
export const Config = configSchema;
// Local-only secret fallback: standalone runs reuse the DeepSeek key from
// data/secrets.local.json when the host (DSH) injects no apiKey. The file is
// never committed or logged; DSH-injected config always wins.
function localSecret(file) {
    try {
        const obj = JSON.parse(readFileSync(file, 'utf8'));
        return typeof obj.deepseekApiKey === 'string' ? obj.deepseekApiKey : '';
    }
    catch {
        return '';
    }
}
/**
 * Resolve the adb serial without letting a missing adb break plugin loading.
 *
 * A host that loads the plugin before adb is reachable must still expose the
 * fish tools; the device layer then fails per call with a readable error
 * instead of the whole plugin disappearing.
 */
function resolveSerialOrEmpty(adbPath, configured) {
    try {
        return resolveDeviceSerial(adbPath, configured);
    }
    catch (err) {
        console.warn(`[dqy] device auto-discovery failed: ${err instanceof Error ? err.message : String(err)}`);
        return '';
    }
}
function truncate(s, max) {
    return s.length > max ? s.slice(0, max) + '…' : s;
}
export function apply(ctx, config) {
    const dataDir = resolve(config.dataDir);
    const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const visionWorker = resolve(packageRoot, 'resources/python/vision_worker.py');
    const voiceWorker = resolve(packageRoot, 'resources/python/voice_worker.py');
    const u2Worker = resolve(packageRoot, 'resources/python/u2_worker.py');
    const templateRoot = resolve(config.templateDir ||
        resolve(packageRoot, 'assets/templates'));
    const voiceDir = resolve(dataDir, 'voice');
    mkdirSync(voiceDir, { recursive: true });
    const voicesDir = resolve(dataDir, 'voices');
    mkdirSync(voicesDir, { recursive: true });
    const gptsovitsSrc = resolve(config.gptsovitsSrc ||
        resolve(packageRoot, 'vendor/gptsovits-src/GPT-SoVITS-main'));
    const gptsovitsModelsDir = resolve(config.gptsovitsModelsDir ||
        resolve(packageRoot, 'vendor/GPT-SoVITS-models'));
    const gptsovitsPythonPath = resolve(config.gptsovitsPythonPath ||
        resolve(packageRoot, 'vendor/gptsovits-venv/Scripts/python.exe'));
    const gptsovitsSynthWorker = resolve(packageRoot, 'resources/python/gptsovits_synth.py');
    // Resolve the adb binary first: the default 'adb' is not on PATH on this
    // machine, so discovery also checks the Android SDK and winget directories.
    const adbPath = resolveAdbPath(config.adbPath);
    const serial = resolveSerialOrEmpty(adbPath, config.deviceSerial);
    const adb = new AdbClient(adbPath, serial || undefined);
    const device = new AndroidDevice(adb, dataDir, () => resolveSerialOrEmpty(adbPath, config.deviceSerial));
    const memory = new JsonMemory(resolve(dataDir, 'memory.json'));
    const llmApiKey = config.apiKey ||
        process.env.DEEPSEEK_API_KEY ||
        localSecret(resolve(dataDir, 'secrets.local.json'));
    // Host model channel first: inside DSH the runtime already owns provider
    // credentials, so the plugin needs no apiKey of its own. Standalone runs
    // (scripts, tests) fall back to the HTTP adapter below.
    const hostLlm = detectHostLlm(ctx);
    const llm = hostLlm && !config.apiKey
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
        });
    const vision = new PythonVision(config.pythonPath, visionWorker, config.visionThreshold);
    const u2 = new Uiautomator2Driver(config.pythonPath, u2Worker, adbPath, serial, resolve(dataDir, 'u2'));
    const adbUi = new AdbUiDriver(device);
    let activeScreenshot = async () => '';
    const visionUi = new VisionUiDriver(vision, templateRoot, () => activeScreenshot());
    const driver = new FallbackUiDriver({
        primary: u2,
        fallback: adbUi,
        vision: visionUi,
    });
    activeScreenshot = async () => {
        // Deliberately the raw driver: this runs inside a vision fallback, i.e.
        // while the serial device already holds its lock. Going through
        // serialDriver here would deadlock the queue.
        const observation = await driver.observe();
        return observation.screenshotPath;
    };
    // Every consumer shares one serialized device: a single phone, one call at a
    // time, with a deadline so a wedged adb call cannot hang the model step.
    const serialDriver = new SerialDevice(driver, {
        timeoutMs: Math.max(10_000, Math.floor(config.toolTimeoutMs * 0.8)),
        observeTimeoutMs: Math.max(15_000, config.toolTimeoutMs),
        onTimeout: (label, timeoutMs) => {
            console.warn(`[dqy] device call ${label} timed out after ${timeoutMs}ms`);
        },
    });
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
    });
    const volcTts = config.volcApiKey || (config.volcAppId && config.volcAccessKey)
        ? new VolcTts({
            apiKey: config.volcApiKey,
            appId: config.volcAppId,
            accessKey: config.volcAccessKey,
            resourceId: config.volcResourceId,
            speaker: config.volcSpeaker,
            audioDir: voiceDir,
        })
        : null;
    const routedVoice = new RoutedVoice({
        pythonVoice: voice,
        volcTts,
        voicesDir,
    });
    const guardrails = new Guardrails({
        allowedApps: config.allowedApps,
        forbiddenPackages: config.forbiddenPackages,
        maxSteps: config.maxSteps,
    });
    const loop = new AgentLoop(device, memory, llm, guardrails, PERSONA, routedVoice);
    const signin = new SignInService(device, memory, config.signInPlans);
    // ---- Outbound control: one policy gate in front of every send path ----
    // The DM pipeline, the tools, the autonomy loop and an owner-approved
    // confirmation all consult this single object, so /halt and the peer
    // whitelist cannot be sidestepped by picking a different caller.
    const stateStore = new FileStateStore(resolve(dataDir, 'state'));
    const outboundGuard = new OutboundGuard({
        allowedPeers: buildPeerSet(config.control.allowedPeers),
        maxLength: config.control.maxLength,
        blockUrl: config.control.blockUrl,
    });
    const runMode = new RunMode(stateStore, outboundGuard, {
        enabled: config.control.enabled,
        dryRun: config.control.dryRun,
        halted: false,
    });
    const messageState = new MessageStateStore(stateStore);
    const confirmations = new ConfirmationQueue(stateStore, config.autonomy.confirmTtlMs);
    const qq = new QqService(serialDriver, llm, memory, routedVoice, messageState);
    const douyin = new DouyinService(serialDriver, memory);
    const game = new GameService(serialDriver, vision, templateRoot, new PriorityTapPolicy([]));
    const bilibili = new BilibiliAdapter(serialDriver, memory);
    const weibo = new WeiboAdapter(serialDriver, memory);
    const xhs = new XhsAdapter(serialDriver, memory);
    // Alipay is an explicit non-goal (see README): no adapter is wired or
    // registered, and related pull requests are not accepted.
    const rawRegistry = new AdapterRegistry();
    rawRegistry.register(qq);
    rawRegistry.register(douyin);
    rawRegistry.register(game);
    rawRegistry.register(bilibili);
    rawRegistry.register(weibo);
    rawRegistry.register(xhs);
    // Everything that dispatches by capability reaches the adapter through this
    // decorator, so an outbound method is decided before it can touch the phone.
    const registry = new GuardedAdapterRegistry(rawRegistry, {
        decide: request => runMode.decide(request),
    });
    const scheduler = new DailyScheduler({
        plans: config.schedules,
        run: async (plan) => {
            const planConfig = signin
                .listPlans()
                .find(p => p.app === plan.app);
            if (!planConfig) {
                throw new DeviceError('PLAN_NOT_FOUND', `no sign-in plan for ${plan.app}`);
            }
            await signin.run(planConfig);
        },
    });
    scheduler.start();
    ctx.effect(() => () => scheduler.stop());
    const notifDir = resolve(dataDir, 'notifications');
    mkdirSync(notifDir, { recursive: true });
    const httpNotifSource = new HttpNotificationSource(config.notifications.httpPort, resolve(notifDir, 'received.log'), {
        bindHost: config.notifications.bindHost,
        token: config.notifications.token,
        maxBodyBytes: config.notifications.maxBodyBytes,
        allowedApps: config.notifications.whitelist,
    });
    const logcatNotifSource = new LogcatNotificationSource(adbPath, serial);
    const notifTunnel = new ReverseTunnelKeepAlive(adbPath, serial);
    const notifRules = (config.notifications.rules ?? []).map((r) => ({
        match: new RegExp(r.pattern, r.caseSensitive ? '' : 'i'),
        action: r.action,
    }));
    const notifPipeline = new NotificationPipeline([
        new WhitelistFilter(new Set(config.notifications.whitelist)),
        new ImportanceFilter(config.notifications.minImportance),
        new AppBlocklistFilter(new Set(config.notifications.blockedApps)),
        new RuleFilter(notifRules),
        new SemanticFilter(llm, config.notifications.semanticEnabled),
        new DedupeFilter(config.notifications.dedupeWindowMs),
    ]);
    // Forward declaration: NotificationService is constructed before the
    // autonomy driver below; the allow-event callback closes over this slot.
    let autonomyDriver = null;
    const notifications = new NotificationService([httpNotifSource, logcatNotifSource], notifPipeline, 100, httpNotifSource, resolve(notifDir, 'cancel.log'), () => autonomyDriver?.onAllowEvent(), config.notifications.failClosed);
    if (config.notifications.enabled) {
        void notifications.start().catch(() => { });
        void notifTunnel.start().catch(() => { });
    }
    ctx.effect(() => () => {
        void notifications.stop();
        notifTunnel.stop();
    });
    // ---- AutonomyLoop: heartbeat -> collect -> LLM decide -> graded act ----
    const autonomySignals = {
        async collect() {
            const allowed = notifications
                .recent(20)
                .filter(d => d.action === 'allow')
                .slice(-6)
                .map(d => `${d.event.app}: ${truncate(d.event.title, 120)}`);
            // recent() instead of recall(): keyword recall can silently miss goals
            // that were just seeded (see experience/autonomy-memory-recall-gap).
            const all = await memory.recent(40);
            const memoryLines = all
                .slice(-6)
                .map(h => `${h.kind}: ${truncate(h.content, 200)}`);
            // Digestible long-term context: newest strategies + latest diary.
            const strategies = all
                .filter(r => r.kind === 'strategy')
                .slice(-3)
                .map(r => `strategy: ${truncate(r.content, 160)}`);
            const diary = all.filter(r => r.kind === 'diary').slice(-1)
                .map(r => `my diary: ${truncate(r.content, 240)}`);
            return {
                notifications: allowed,
                now: new Date().toISOString(),
                memory: [...strategies, ...diary, ...memoryLines],
            };
        },
    };
    const autonomyPolicy = new DefaultAutonomyPolicy({
        guardEnabled: config.autonomy.guardEnabled,
        autoActions: config.autonomy.autoActions,
        forbiddenActions: config.autonomy.forbiddenActions,
    });
    const autonomyConfirm = {
        async confirmRequired(decision, reason) {
            // A confirm decision used to become a console line and a memory entry,
            // which nobody ever saw. It now becomes a durable inbox item that only
            // the owner can approve (never the model).
            const action = confirmations.enqueue({
                app: decision.app ?? '',
                capability: decision.capability ?? '',
                method: decision.method ?? '',
                args: decision.args ?? {},
                reason,
            });
            console.log(`[autonomy] queued for owner approval: ${action.id} ` +
                `${action.app}/${action.capability}/${action.method}`);
            await memory.remember({
                kind: 'event',
                content: `autonomy confirmation queued ${action.id}: ` +
                    `${action.app}/${action.capability}/${action.method} | ${reason}`,
                tags: ['autonomy', 'confirm-pending'],
            });
        },
    };
    const autonomyLoop = new AutonomyLoop({
        memory,
        llm,
        registry,
        signals: autonomySignals,
        policy: autonomyPolicy,
        confirm: autonomyConfirm,
        diary: new DiaryWriter({ llm, memory }),
    });
    // Heartbeat fires driver.wake('heartbeat'); driver then re-schedules with a
    // clamped interval derived from the LLM's nextWakeMs self-report.
    const heartbeat = new HeartbeatScheduler({
        initialIntervalMs: config.autonomy.heartbeatMs,
        onTick: () => autonomyDriver?.wake('heartbeat'),
    });
    autonomyDriver = new AutonomyDriver({
        loop: autonomyLoop,
        scheduler: heartbeat,
        config: {
            minWakeMs: config.autonomy.minWakeMs,
            maxWakeMs: config.autonomy.maxWakeMs,
            fallbackWakeMs: config.autonomy.fallbackWakeMs,
            wakeOnEvent: config.autonomy.wakeOnEvent,
        },
    });
    if (config.autonomy.enabled) {
        try {
            autonomyDriver.start();
            ctx.effect(() => () => autonomyDriver?.stop());
        }
        catch (err) {
            // A failing first tick must not take the plugin (and its tools) down.
            console.warn(`[dqy] autonomy start failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ---- Watch control: recipes and the notification-driven DM pipeline.
    // The policy state itself (run mode, guard, message journal, confirmation
    // inbox) is constructed above the adapters so every caller shares it.
    const recipeDir = resolve(config.control.recipeDir ||
        resolve(packageRoot, 'assets/recipes'));
    const recipes = new RecipeLoader(recipeDir).loadAll();
    const recipeExecutor = new RecipeExecutor(serialDriver);
    const recipeSender = new RecipeDirectMessageSender(recipeExecutor, recipes);
    const douyinDmSender = new DouyinDmSender(serialDriver);
    const dmSender = {
        async send(input) {
            // Douyin resumes into the DM chat when the notification fires, where the
            // recipe's "tap 消息 → peer" navigation cannot work; use the direct UI
            // sender instead. Other platforms keep the declarative recipe.
            if (input.app === DOUYIN_PACKAGE) {
                return douyinDmSender.send(input);
            }
            return recipeSender.send(input);
        },
    };
    const dmWatch = new DmWatchPipeline(messageState, runMode, llm, dmSender, { dedupeWindowMs: config.notifications.dedupeWindowMs });
    // Every allowed notification enters the watch pipeline. The pipeline is
    // idempotent, so replayed notifications never produce a second reply.
    notifications.onEvent(decision => {
        if (decision.action === 'allow') {
            void dmWatch.handle(decision.event).catch(() => { });
        }
    });
    // ---- QQ auto reply: any signal -> read unread -> reply (gated) ----
    // Two triggers: the notification event pipeline, and a direct poll of the
    // phone's notification store. The poll is what makes it "real time": it does
    // not depend on the shade, the bridge APK, or which app is in the foreground.
    let qqReplyBusy = false;
    let qqPending = null;
    const qqLog = createFileLogger(resolve(dataDir, 'qq-auto-reply.log'));
    const runQqAutoReply = async (source, peer, message) => {
        qqLog(`trigger source=${source} peer=${peer ?? '-'} busy=${qqReplyBusy}`);
        if (!config.control.qqAutoReply) {
            qqLog('skip: qqAutoReply disabled');
            return;
        }
        if (qqReplyBusy) {
            // Never drop a message just because another reply is in flight: keep the
            // newest request and run it as soon as the current one finishes.
            qqPending = { source, peer, message };
            qqLog(`queued while busy: peer=${peer ?? '-'}`);
            return;
        }
        qqReplyBusy = true;
        const authorize = (input) => runMode.decide({
            app: qq.packageName,
            surface: 'message',
            peer: input.peer,
            text: input.text,
        });
        try {
            // The notification names the peer; opening that chat directly avoids the
            // unread-badge race (QQ clears the badge as soon as it is handled).
            if (peer) {
                const single = await qq
                    .replyToPeer(peer, authorize, message)
                    .catch(err => {
                    console.warn(`[qq] replyToPeer(${peer}) failed:`, err.message);
                    return null;
                });
                if (single) {
                    qqLog(`replyToPeer ok: peer=${single.peer} sent=${single.sent} text=${single.reply}`);
                    console.log(`[qq] auto reply (${source}) to ${single.peer}: sent=${single.sent}`);
                    return;
                }
                qqLog(`replyToPeer returned null (duplicate or empty) peer=${peer}`);
                // The peer was known and already handled; a second unread scan would
                // just repeat the same slow UI pass for no gain.
                if (peer) {
                    return;
                }
            }
            const replies = await qq.replyToUnread({
                maxConversations: 1,
                authorize,
            });
            if (replies.length > 0) {
                console.log(`[qq] auto reply (${source}): ${replies
                    .map(r => `${r.peer} sent=${r.sent}`)
                    .join(', ')}`);
                return;
            }
            // Nothing replied: record it, otherwise "why didn't she answer" is
            // indistinguishable from "the trigger never fired".
            qqLog(`no reply produced; fallback unread scan found nothing (peer=${peer ?? '-'})`);
            await memory.remember({
                kind: 'event',
                content: `QQ 自动回复触发（${source}），但没有可回的未读行（peer=${peer ?? '-'}）`,
                tags: ['qq', 'auto-reply', 'no-unread'],
            });
        }
        catch (err) {
            qqLog(`failed: ${err.message}`);
            console.warn(`[qq] auto reply (${source}) failed:`, err.message);
        }
        finally {
            qqReplyBusy = false;
            const next = qqPending;
            qqPending = null;
            if (next) {
                qqLog(`draining queued reply: peer=${next.peer ?? '-'}`);
                void runQqAutoReply(next.source, next.peer, next.message);
            }
        }
    };
    notifications.onEvent(decision => {
        if (decision.action !== 'allow' ||
            decision.event.app !== 'com.tencent.mobileqq') {
            return;
        }
        // Let the notification shade settle before QQ is opened and read.
        setTimeout(() => {
            void runQqAutoReply('notification', decision.event.title || undefined, {
                text: decision.event.text,
                when: decision.event.when,
            });
        }, 1500);
    });
    const qqWatchMs = config.control.qqWatchMs ?? 5000;
    if (config.control.enabled && config.control.qqAutoReply && qqWatchMs > 0) {
        const qqWatcher = new QqNotificationWatcher({
            readNotifications: () => adb.run(['shell', 'dumpsys', 'notification', '--noredact'], 20000),
            onPing: ping => {
                void runQqAutoReply(`watch:${ping.title || 'qq'}`, ping.title || undefined, { text: ping.text });
            },
            intervalMs: qqWatchMs,
            packageName: qq.packageName,
            logger: message => console.log('[qq-watch]', message),
        });
        qqWatcher.start();
        ctx.effect(() => () => qqWatcher.stop());
    }
    // Mirror panel subsystem: a file-backed config, a scrcpy process adapter and
    // the application service, exposed over the host web server together with an
    // injected in-page panel. Every piece depends on domain ports, never directly
    // on the untyped host runtime.
    const mirrorConfigPath = resolve(dataDir, 'mirror-config.json');
    const mirrorLogPath = resolve(dataDir, 'mirror.log');
    const panelAssetPath = resolve(packageRoot, 'resources', 'mirror', 'panel.js');
    const pluginVersion = (() => {
        try {
            return String(JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version ?? '0.0.0');
        }
        catch {
            return '0.0.0';
        }
    })();
    const initialMirrorConfig = {
        serial,
        adb: '',
        scrcpy: '',
        autoStart: false,
        alwaysOnTop: config.mirror.alwaysOnTop,
        windowWidth: config.mirror.windowWidth,
        turnScreenOff: config.mirror.turnScreenOff,
        audio: config.mirror.audio,
        graceMs: config.mirror.graceMs,
        reconnect: config.mirror.reconnect,
        pin: '',
    };
    const mirrorShell = new NodeShell();
    const mirrorConfigStore = new FileMirrorConfigStore(mirrorConfigPath, initialMirrorConfig);
    const mirrorLogger = createFileLogger(mirrorLogPath);
    // Holder breaks the circular reference: the process adapter reports exits to
    // the panel service, which is constructed immediately afterwards.
    let panelHolder;
    const mirrorProcess = new ScrcpyMirror({
        resolveAdb: resolveAdbPath,
        resolveScrcpy: resolveScrcpyPath,
        onExit: (code, byUser) => panelHolder.handleExit(code, byUser),
    });
    const mirrorPanel = new MirrorPanelService({
        configStore: mirrorConfigStore,
        mirror: mirrorProcess,
        shell: mirrorShell,
        resolveAdb: resolveAdbPath,
        resolveScrcpy: resolveScrcpyPath,
        pluginVersion,
        logPath: mirrorLogPath,
        panelAssetPath,
        logger: mirrorLogger,
    });
    panelHolder = mirrorPanel;
    // The host web server is injected at runtime without a published type, so it
    // is adapted to the domain WebServerPort behind a structural cast.
    const hostWebServer = new CordisWebServer(ctx.webServer, ctx);
    const httpController = new MirrorHttpController(hostWebServer, mirrorPanel, '/dqy-mirror');
    const stopHttp = httpController.register();
    // Auto-start mirroring after a short delay when the config requests it.
    if (mirrorConfigStore.load().autoStart) {
        const autoTimer = setTimeout(() => {
            mirrorPanel.start().catch(() => { });
        }, 2500);
        ctx.effect(() => () => clearTimeout(autoTimer));
    }
    // Never leave scrcpy or the HTTP routes orphaned on shutdown.
    const shutdownMirror = () => {
        stopHttp();
        mirrorPanel.stop().catch(() => { });
    };
    const onProcessExit = () => {
        stopHttp();
    };
    process.once('exit', onProcessExit);
    ctx.effect(() => () => {
        process.removeListener('exit', onProcessExit);
        shutdownMirror();
    });
    // Owner-only approval: reaches the raw registry on purpose, after the policy
    // has re-checked content rules with `humanApproved`. The model cannot call
    // this path, it is reached only from the /confirm slash command.
    const approveAction = async (action) => {
        const args = action.args;
        const decision = runMode.decide({
            app: action.app,
            surface: surfaceFor(action.capability, action.method),
            peer: typeof args.peer === 'string' ? args.peer : undefined,
            text: typeof args.text === 'string' ? args.text : '',
        }, { humanApproved: true });
        if (decision.verdict !== 'allow') {
            throw new PolicyBlockedError('POLICY_BLOCKED', decision.reasons.join('; '), decision.reasons);
        }
        const capability = action.capability;
        const capabilityObject = rawRegistry.getCapability(action.app, capability);
        const fn = capabilityObject[action.method];
        if (typeof fn !== 'function') {
            throw new AdapterError('ACTION_NOT_FOUND', `adapter ${action.app} has no callable ${action.method}`);
        }
        const raw = await fn.call(capabilityObject, action.args);
        const result = raw && typeof raw === 'object'
            ? raw
            : undefined;
        return `${action.app}/${action.capability}/${action.method}: ${result?.ok === false ? 'failed' : 'executed'}${result?.detail ? ` - ${result.detail}` : ''}`;
    };
    const services = {
        loop,
        signin,
        device: serialDriver,
        memory,
        vision,
        voice: routedVoice,
        qq,
        douyin,
        game,
        scheduler,
        adapters: registry,
        adbPath: adbPath,
        deviceSerial: serial,
        notifications,
        runMode,
        messageState,
        dmWatch,
        mirror: mirrorPanel,
        confirmations,
        toolTimeoutMs: config.toolTimeoutMs,
        describePolicy: () => {
            const snapshot = runMode.snapshot();
            const pending = confirmations.list().length;
            const peers = config.control.allowedPeers.length;
            const auto = config.autonomy.autoActions.length;
            const lines = [
                snapshot.halted
                    ? '发送：急停中（/watch resume 解除后仍需 /watch enable）'
                    : snapshot.enabled
                        ? snapshot.dryRun
                            ? '发送：已开启，但处于试运行（只记录、不真发）'
                            : '发送：已开启，会真实发送'
                        : '发送：关闭（这是默认值，/watch enable 开启）',
                `收件人白名单：${peers} 个${peers === 0 ? '（空列表 = 谁都不能发）' : ''}`,
                `待你批准的动作：${pending} 个${pending > 0 ? '（/confirm list 查看）' : ''}`,
                `自主循环：${config.autonomy.enabled ? '运行中' : '关闭'}，可自动执行 ${auto} 条动作`,
            ];
            if (!snapshot.enabled && !snapshot.halted) {
                lines.push('现在她只观察、写日记，不对外说话。要她开口：/watch enable 然后 /watch live。');
            }
            if (peers === 0) {
                lines.push('白名单还是空的：先写 control.allowedPeers，格式 "包名:对方名"，' +
                    '例如 "com.tencent.mobileqq:张三"。');
            }
            if (snapshot.enabled && snapshot.dryRun) {
                lines.push('试运行会把她想发的话记进记忆，确认没问题后再 /watch live。');
            }
            return lines.join('\n');
        },
    };
    registerTools(ctx, services);
    registerCommands(ctx, {
        ...services,
        confirmations,
        approveAction,
    });
    registerPersona(ctx);
}
