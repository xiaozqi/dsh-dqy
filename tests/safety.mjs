// Safety-property tests for the outbound gate, the confirmation inbox, the
// input quoting and the serialized device. They run entirely in-process: no
// phone, no network, no model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { OutboundGuard, buildPeerSet, peerKey } from '../lib/application/control/outbound-guard.js'
import { RunMode } from '../lib/application/control/run-mode.js'
import { GuardedAdapterRegistry } from '../lib/application/control/guarded-adapters.js'
import { ConfirmationQueue } from '../lib/application/control/confirmation-queue.js'
import { NotificationService } from '../lib/application/notifications/notification.service.js'
import { HttpNotificationSource } from '../lib/infrastructure/notifications/http-notification-source.js'
import { SerialDevice } from '../lib/infrastructure/device/serial-device.js'
import {
  assertPackageName,
  encodeAdbInputText,
  sanitizeShellText,
  toBase64,
} from '../lib/infrastructure/adb/shell-quote.js'
import { DeviceTimeoutError, PolicyBlockedError } from '../lib/domain/errors.js'
import { ProcessSupervisor } from '../lib/infrastructure/process-supervisor.js'

function memoryStore() {
  const map = new Map()
  const clone = value => JSON.parse(JSON.stringify(value))
  return {
    load: (key, fallback) => (map.has(key) ? clone(map.get(key)) : fallback),
    save: (key, value) => {
      map.set(key, clone(value))
    },
  }
}

function guard(peers = []) {
  return new OutboundGuard({
    allowedPeers: buildPeerSet(peers),
    maxLength: 20,
    blockUrl: true,
  })
}

function liveMode(peers = ['com.tencent.mobileqq:张三']) {
  const runMode = new RunMode(memoryStore(), guard(peers), {
    enabled: true,
    dryRun: false,
    halted: false,
  })
  return runMode
}

// ---------------------------------------------------------------- guard ----

test('guard: a person-targeted surface needs a whitelisted peer', () => {
  const g = guard([])
  const reasons = g.inspect({
    app: 'com.tencent.mobileqq',
    surface: 'message',
    peer: '陌生人',
    text: '你好',
  })
  assert.ok(reasons.some(r => r.includes('peer not whitelisted')))
})

test('guard: the whitelist key is package:peer and is parsed from config', () => {
  const g = guard(['com.tencent.mobileqq:张三'])
  assert.deepEqual(
    g.inspect({
      app: 'com.tencent.mobileqq',
      surface: 'message',
      peer: '张三',
      text: '你好',
    }),
    [],
  )
  // A different app with the same peer name does not inherit the entry.
  assert.ok(
    g.inspect({
      app: 'com.tencent.mobileqq',
      surface: 'message',
      peer: '张三:extra',
      text: '你好',
    }).length > 0,
  )
  assert.equal(peerKey('app', 'peer'), 'app:peer')
})

test('guard: public surfaces need no peer, but still check content', () => {
  const g = guard([])
  assert.deepEqual(
    g.inspect({ app: 'qq', surface: 'moment', text: '今天天气不错' }),
    [],
  )
  assert.ok(
    g.inspect({ app: 'qq', surface: 'moment', text: '看 http://x.y' }).length > 0,
  )
  assert.ok(
    g.inspect({ app: 'qq', surface: 'comment', text: '' }).some(r =>
      r.includes('empty text'),
    ),
  )
})

// ------------------------------------------------------------- run mode ----

test('run mode: default state blocks every outbound call', () => {
  const runMode = new RunMode(memoryStore(), guard(['app:peer']), {
    enabled: false,
    dryRun: true,
    halted: false,
  })
  const decision = runMode.decide({
    app: 'app',
    surface: 'message',
    peer: 'peer',
    text: 'hi',
  })
  assert.equal(decision.verdict, 'block')
})

test('run mode: dry run never reaches allow, halt beats a human approval', () => {
  const runMode = new RunMode(memoryStore(), guard(['app:peer']), {
    enabled: true,
    dryRun: true,
    halted: false,
  })
  const request = { app: 'app', surface: 'message', peer: 'peer', text: 'hi' }
  assert.equal(runMode.decide(request).verdict, 'dry-run')
  runMode.halt()
  assert.equal(runMode.decide(request, { humanApproved: true }).verdict, 'block')
})

test('run mode: content rules survive a human approval', () => {
  const runMode = liveMode()
  const decision = runMode.decide(
    {
      app: 'com.tencent.mobileqq',
      surface: 'message',
      peer: '张三',
      text: 'see http://evil.example',
    },
    { humanApproved: true },
  )
  assert.equal(decision.verdict, 'block')
})

test('run mode: device-only actions are not gated by the send switch', () => {
  const runMode = new RunMode(memoryStore(), guard(), {
    enabled: false,
    dryRun: true,
    halted: true,
  })
  assert.equal(
    runMode.decide({ app: 'qq', surface: 'device' }).verdict,
    'allow',
  )
})

// -------------------------------------------------------------- gateway ----

function fakeRegistry(adapter) {
  return {
    register() {},
    list: () => [adapter],
    get: id => {
      if (id !== adapter.id) throw new Error(`no adapter ${id}`)
      return adapter
    },
    getCapability: (id, capability) => {
      if (id !== adapter.id) throw new Error(`no adapter ${id}`)
      if (!adapter.capabilities.includes(capability)) {
        throw new Error(`no capability ${capability}`)
      }
      return adapter
    },
    listTodos: () => [],
  }
}

function fakeAdapter() {
  const calls = []
  const adapter = {
    id: 'qq',
    displayName: 'QQ',
    packageName: 'com.tencent.mobileqq',
    capabilities: ['message', 'moment'],
    todos: [],
    calls,
    async sendMessage(input) {
      calls.push(['sendMessage', input])
      return { ok: true, sent: true, detail: 'sent' }
    },
    async publishMoment(input) {
      calls.push(['publishMoment', input])
      return { ok: true, sent: true, detail: 'posted' }
    },
  }
  return adapter
}

test('gateway: a blocked send throws and never touches the adapter', async () => {
  const adapter = fakeAdapter()
  const registry = new GuardedAdapterRegistry(fakeRegistry(adapter), {
    decide: () => ({ verdict: 'block', reasons: ['peer not whitelisted'] }),
  })
  const capability = registry.getCapability('qq', 'message')
  await assert.rejects(
    () => capability.sendMessage({ peer: '陌生人', text: 'hi' }),
    error => error instanceof PolicyBlockedError,
  )
  assert.equal(adapter.calls.length, 0)
})

test('gateway: a dry run returns sent=false and never touches the adapter', async () => {
  const adapter = fakeAdapter()
  const registry = new GuardedAdapterRegistry(fakeRegistry(adapter), {
    decide: () => ({ verdict: 'dry-run', reasons: ['dry run mode'] }),
  })
  const capability = registry.getCapability('qq', 'message')
  const result = await capability.sendMessage({ peer: '张三', text: 'hi' })
  assert.equal(result.ok, true)
  assert.equal(result.sent, false)
  assert.match(result.detail, /dry-run/)
  assert.equal(adapter.calls.length, 0)
})

test('gateway: an allowed send reaches the adapter once', async () => {
  const adapter = fakeAdapter()
  const registry = new GuardedAdapterRegistry(fakeRegistry(adapter), {
    decide: () => ({ verdict: 'allow', reasons: [] }),
  })
  const capability = registry.getCapability('qq', 'message')
  const result = await capability.sendMessage({ peer: '张三', text: 'hi' })
  assert.equal(result.sent, true)
  assert.equal(adapter.calls.length, 1)
  assert.equal(adapter.calls[0][1].peer, '张三')
})

test('gateway: a mention payload is checked against the friend field', async () => {
  const adapter = fakeAdapter()
  adapter.capabilities.push('social')
  const seen = []
  adapter.mention = async input => {
    adapter.calls.push(['mention', input])
    return { ok: true, sent: true, detail: 'mentioned' }
  }
  const registry = new GuardedAdapterRegistry(fakeRegistry(adapter), {
    decide: request => {
      seen.push(request)
      return { verdict: 'allow', reasons: [] }
    },
  })
  await registry
    .getCapability('qq', 'social')
    .mention({ friend: '张三', text: 'hi' })
  assert.equal(seen[0].surface, 'mention')
  assert.equal(seen[0].peer, '张三')
})

test('gateway: read-only capability methods are not gated', async () => {
  const adapter = fakeAdapter()
  adapter.readConversation = async () => ({ peer: 'p', incoming: [] })
  const registry = new GuardedAdapterRegistry(fakeRegistry(adapter), {
    decide: () => ({ verdict: 'block', reasons: ['nope'] }),
  })
  const preview = await registry
    .getCapability('qq', 'message')
    .readConversation()
  assert.deepEqual(preview.incoming, [])
})

// ----------------------------------------------------------- confirmations ---

test('confirmation inbox: dedupes, expires and is only consumed once', () => {
  const queue = new ConfirmationQueue(memoryStore(), 1000)
  const first = queue.enqueue({
    app: 'qq',
    capability: 'message',
    method: 'sendMessage',
    args: { peer: '张三', text: 'hi' },
    reason: 'needs owner',
  })
  const again = queue.enqueue({
    app: 'qq',
    capability: 'message',
    method: 'sendMessage',
    args: { peer: '张三', text: 'hi' },
    reason: 'needs owner',
  })
  assert.equal(first.id, again.id)
  assert.equal(queue.list().length, 1)
  assert.equal(queue.take(first.id)?.id, first.id)
  assert.equal(queue.take(first.id), null)
})

test('confirmation inbox: expired actions are dropped', async () => {
  const queue = new ConfirmationQueue(memoryStore(), 5)
  const action = queue.enqueue({
    app: 'qq',
    capability: 'message',
    method: 'sendMessage',
    args: {},
    reason: 'x',
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(queue.take(action.id), null)
  assert.equal(queue.list().length, 0)
})

// ------------------------------------------------------------------ input ---

test('input: shell metacharacters cannot escape the device shell', () => {
  const payload = "$(rm -rf /sdcard) `id` ; reboot ' \" \\ \n"
  const encoded = encodeAdbInputText(sanitizeShellText(payload))
  assert.ok(encoded.startsWith("'") && encoded.endsWith("'"))
  // Every embedded quote is closed and re-opened, never left bare.
  assert.equal(encoded.slice(1, -1).includes("'"), true)
  assert.equal(encoded.includes('$(rm'), true) // content preserved...
  assert.equal(encoded.includes("'\\''"), true) // ...but quoted
  assert.equal(encoded.includes('\n'), false)
})

test('input: newlines are folded and NULs removed', () => {
  assert.equal(sanitizeShellText('a\nb\tc\r\nd\0e'), 'a b c de')
})

test('input: base64 payload carries no shell metacharacters', () => {
  const b64 = toBase64('你好 $(whoami)')
  assert.equal(/^[A-Za-z0-9+/=]+$/.test(b64), true)
})

test('input: package names are validated, not quoted', () => {
  assert.equal(assertPackageName('com.tencent.mobileqq'), 'com.tencent.mobileqq')
  assert.throws(() => assertPackageName('com.tencent.mobileqq; rm -rf /'))
  assert.throws(() => assertPackageName('$(id)'))
})

// --------------------------------------------------------- serial device ----

function fakeDriver(overrides = {}) {
  let active = 0
  let maxActive = 0
  const trace = []
  const wrap = (name, delayMs, result) => async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    trace.push(`start:${name}`)
    try {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      trace.push(`end:${name}`)
      return result
    } finally {
      active -= 1
    }
  }
  return {
    kind: 'fake',
    trace,
    get maxActive() {
      return maxActive
    },
    connect: wrap('connect', 1),
    isConnected: async () => true,
    screenSize: async () => ({ width: 1080, height: 2400 }),
    foregroundApp: async () => 'com.tencent.mobileqq',
    tap: wrap('tap', 20),
    longPress: wrap('longPress', 1),
    swipe: wrap('swipe', 1),
    inputText: wrap('inputText', 1),
    inputChinese: wrap('inputChinese', 1),
    pressKey: wrap('pressKey', 1),
    openApp: wrap('openApp', 1),
    observe: async () => ({
      screenshotPath: '/tmp/x.png',
      foregroundApp: 'com.tencent.mobileqq',
      screenSize: { width: 1080, height: 2400 },
      roots: [],
      capturedAt: new Date().toISOString(),
    }),
    findText: async () => null,
    findNodes: async () => [],
    tapControl: async () => {
      throw new Error('not used')
    },
    pushFile: wrap('pushFile', 1),
    pullFile: wrap('pullFile', 1),
    playAudio: wrap('playAudio', 1),
    recordAudio: wrap('recordAudio', 1),
    ...overrides,
  }
}

test('serial device: concurrent calls never overlap', async () => {
  const inner = fakeDriver()
  const device = new SerialDevice(inner, { timeoutMs: 1000 })
  await Promise.all([
    device.tap({ x: 1, y: 2 }),
    device.tap({ x: 3, y: 4 }),
    device.swipe({ x: 0, y: 0 }, { x: 5, y: 5 }, 10),
  ])
  assert.equal(inner.maxActive, 1)
  assert.deepEqual(inner.trace, [
    'start:tap',
    'end:tap',
    'start:tap',
    'end:tap',
    'start:swipe',
    'end:swipe',
  ])
})

test('serial device: a hung call fails with a typed timeout', async () => {
  const inner = fakeDriver({
    tap: () => new Promise(() => {}),
  })
  const device = new SerialDevice(inner, { timeoutMs: 30 })
  await assert.rejects(
    () => device.tap({ x: 1, y: 2 }),
    error => error instanceof DeviceTimeoutError,
  )
})

// ------------------------------------------------------------ notification ---

test('notifications: a throwing filter chain blocks instead of allowing', async () => {
  let allowedWakeups = 0
  const service = new NotificationService(
    [],
    {
      async decide() {
        throw new Error('filter exploded')
      },
    },
    10,
    undefined,
    undefined,
    () => {
      allowedWakeups += 1
    },
    true,
  )
  await service.start()
  const decisions = []
  service.onEvent(decision => decisions.push(decision))
  // Drive the private handler the same way a source would.
  await service['handle']({
    id: 'n1',
    app: 'com.tencent.mobileqq',
    title: '张三',
    text: '在吗',
    when: Date.now(),
    importance: 2,
    source: 'http',
  })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].action, 'block')
  assert.equal(decisions[0].reason, 'pipeline-error')
  assert.equal(allowedWakeups, 0)
})

function post(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

test('notification bridge: token, body cap and app allowlist are enforced', async () => {
  const source = new HttpNotificationSource(0, '/tmp/fish-test-notify.log', {
    bindHost: '127.0.0.1',
    token: 'secret',
    maxBodyBytes: 128,
    allowedApps: ['com.tencent.mobileqq'],
    logger: () => {},
  })
  await source.start()
  const port = source.server.address().port
  assert.equal(source.server.address().address, '127.0.0.1')
  const body = {
    app: 'com.tencent.mobileqq',
    title: '张三',
    text: '在吗',
  }

  assert.equal(await post(port, '/notify', body), 403)
  assert.equal(
    await post(port, '/notify', body, { 'x-fish-token': 'secret' }),
    200,
  )
  assert.equal(
    await post(port, '/notify', { ...body, app: 'com.evil.app' }, {
      'x-fish-token': 'secret',
    }),
    400,
  )
  assert.equal(
    await post(
      port,
      '/notify',
      { ...body, text: 'x'.repeat(500) },
      { 'x-fish-token': 'secret' },
    ),
    413,
  )
  await source.stop()
})

test('process supervisor: a hung child is killed at the deadline', async () => {
  const supervisor = new ProcessSupervisor()
  const started = Date.now()
  const result = await supervisor.run(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)'],
    { timeoutMs: 150 },
  )
  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 10000)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(supervisor.size, 0)
})

test('process supervisor: both streams are captured', async () => {
  const supervisor = new ProcessSupervisor()
  const result = await supervisor.run(
    process.execPath,
    ['-e', 'process.stdout.write("out");process.stderr.write("err")'],
    { timeoutMs: 10000 },
  )
  assert.equal(result.timedOut, false)
  assert.equal(result.stdout, 'out')
  assert.match(result.stderr, /err/)
})
test('reverse tunnel: an adb timeout is reported and ticks never overlap', async () => {
  const { ReverseTunnelKeepAlive } = await import(
    '../lib/infrastructure/notifications/reverse-tunnel.js'
  )
  let calls = 0
  let release
  const fake = {
    run: async () => {
      calls += 1
      await new Promise(resolve => {
        release = resolve
      })
      return { code: null, stdout: '', stderr: '', timedOut: true }
    },
  }
  const tunnel = new ReverseTunnelKeepAlive('adb', 'serial', 14123, 14123, 10, fake)
  const started = tunnel.start()
  await new Promise(resolve => setTimeout(resolve, 30))
  // A second tick arrived while the first was still in flight: it must not
  // spawn another adb process.
  assert.equal(calls, 1)
  release()
  await started
  tunnel.stop()
  assert.match(tunnel.lastError, /超时/)
})

test('device: a wireless reconnect refreshes the serial and retries connect', async () => {
  const { AndroidDevice } = await import(
    '../lib/infrastructure/adb/android-device.js'
  )
  const dir = join(tmpdir(), `dqy-dev-${Date.now()}`)
  let serial = 'old:5555'
  const adb = {
    listDevices: async () => (serial === 'new:5555' ? ['new:5555'] : []),
    get currentSerial() {
      return serial
    },
    setSerial(next) {
      serial = next
    },
  }
  const device = new AndroidDevice(adb, dir, () => 'new:5555')
  await device.connect()
  assert.equal(serial, 'new:5555')
  rmSync(dir, { recursive: true, force: true })
})

test('action parser: trailing prose and a second object are ignored', async () => {
  const { parseActionContent } = await import(
    '../lib/infrastructure/llm/action-parser.js'
  )
  const action = parseActionContent(
    '先说明：我要点一下\n{"thought":"tap it","name":"tap","args":{"x":1,"y":2}}\n{"note":"extra object"}',
  )
  assert.equal(action.name, 'tap')
  assert.deepEqual(action.args, { x: 1, y: 2 })
})

test('action parser: braces inside strings do not break the scan', () => {
  return import('../lib/infrastructure/llm/action-parser.js').then(({ parseActionContent }) => {
    const action = parseActionContent(
      '{"thought":"text has } brace","name":"finish","args":{"summary":"a } b"}}',
    )
    assert.equal(action.name, 'finish')
  })
})

test('qq watcher: parses the phone notification dump, ignoring other apps', async () => {
  const { parseQqNotifications } = await import(
    '../lib/infrastructure/notifications/qq-notification-watcher.js'
  )
  const dump = [
    'NotificationRecord(0x1: pkg=android user=UserHandle{0} id=1 tag=null importance=2 key=0|android|1|null|1000',
    '  android.title=String (来电和通知都会静音)',
    '  android.text=String (勿扰)',
    'NotificationRecord(0x2: pkg=com.tencent.mobileqq user=UserHandle{0} id=7 tag=null importance=2 key=0|com.tencent.mobileqq|7|null|10217',
    '  android.title=String (张三)',
    '  android.text=String (在吗，回我一下)',
  ].join('\n')
  const pings = parseQqNotifications(dump)
  assert.equal(pings.length, 1)
  assert.equal(pings[0].title, '张三')
  assert.equal(pings[0].text, '在吗，回我一下')
  assert.equal(pings[0].key, '0|com.tencent.mobileqq|7|null|10217')
})

test('qq watcher: a dump without QQ notifications yields nothing', async () => {
  const { parseQqNotifications } = await import(
    '../lib/infrastructure/notifications/qq-notification-watcher.js'
  )
  assert.deepEqual(
    parseQqNotifications('NotificationRecord(0x1: pkg=android key=0|android|1|null|1000'),
    [],
  )
})

test('flow lock: a second flow never overlaps the first', async () => {
  const { FlowLock } = await import('../lib/application/support/flow-lock.js')
  const lock = new FlowLock()
  const events = []
  const first = lock.run(async () => {
    events.push('a-start')
    await new Promise(resolve => setTimeout(resolve, 60))
    events.push('a-end')
  })
  const second = lock.run(async () => {
    events.push('b-start')
    events.push('b-end')
  })
  await Promise.all([first, second])
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end'])
})

function pipelineDeps(options = {}) {
  const phases = []
  const state = {
    seen: () => false,
    claim: () => {},
    transition: (_key, phase) => phases.push(phase),
    get: () => undefined,
  }
  const runMode = { gate: () => ({ verdict: 'allow', reasons: [] }) }
  const llm = {
    chat: options.chat ?? (async () => '{"shouldReply":true,"reply":"ok"}'),
  }
  let attempts = 0
  const sender = {
    send: async () => {
      attempts += 1
      const err = options.sendError ? options.sendError() : null
      if (err) {
        throw err
      }
    },
  }
  return { phases, state, runMode, llm, sender, attempts: () => attempts }
}

test('dm pipeline: invalid model output fails loudly instead of "no reply needed"', async () => {
  const { DmWatchPipeline } = await import(
    '../lib/application/control/dm-watch-pipeline.js'
  )
  const deps = pipelineDeps({ chat: async () => 'not json at all' })
  const pipeline = new DmWatchPipeline(
    deps.state,
    deps.runMode,
    deps.llm,
    deps.sender,
    { dedupeWindowMs: 3000 },
  )
  const outcome = await pipeline.handle({
    app: 'com.tencent.mobileqq',
    title: 'p',
    text: 'hi',
    when: Date.now(),
  })
  assert.equal(outcome.result, 'blocked')
  assert.match(outcome.detail, /LLM_DECISION_INVALID/)
  assert.equal(deps.attempts(), 0)
  assert.ok(deps.phases.includes('failed'))
  assert.ok(!deps.phases.includes('verified'))
})

test('dm pipeline: a transient send failure is retried once', async () => {
  const { DmWatchPipeline } = await import(
    '../lib/application/control/dm-watch-pipeline.js'
  )
  let first = true
  const deps = pipelineDeps({
    sendError: () => {
      if (first) {
        first = false
        return new Error('UI not ready')
      }
      return null
    },
  })
  const pipeline = new DmWatchPipeline(
    deps.state,
    deps.runMode,
    deps.llm,
    deps.sender,
    { dedupeWindowMs: 3000 },
  )
  const outcome = await pipeline.handle({
    app: 'com.ss.android.ugc.aweme',
    title: 'p',
    text: 'hi',
    when: Date.now(),
  })
  assert.equal(outcome.result, 'sent')
  assert.equal(deps.attempts(), 2)
})

test('dm pipeline: an unconfirmed send is not retried (no double message)', async () => {
  const { DmWatchPipeline } = await import(
    '../lib/application/control/dm-watch-pipeline.js'
  )
  const { DeviceError } = await import('../lib/domain/errors.js')
  const deps = pipelineDeps({
    sendError: () =>
      new DeviceError('DM_SEND_UNCONFIRMED', 'bubble not visible'),
  })
  const pipeline = new DmWatchPipeline(
    deps.state,
    deps.runMode,
    deps.llm,
    deps.sender,
    { dedupeWindowMs: 3000 },
  )
  const outcome = await pipeline.handle({
    app: 'com.ss.android.ugc.aweme',
    title: 'p',
    text: 'hi',
    when: Date.now(),
  })
  assert.equal(outcome.result, 'blocked')
  assert.equal(deps.attempts(), 1)
})