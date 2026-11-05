// Smoke test for the AutonomyLoop closed loop:
//   round 1 -> whitelisted auto action executes (3-part key)
//   round 2 -> cross-app whitelisted action (2-part key) executes without confirm
//   round 3 -> forbidden action pauses for confirm (never executes)
//   round 4 -> illegal action (unknown app) is skipped, no confirm, no exec
//   round 5 -> idle produces no side effects
// Uses real AdapterRegistry + real policy, fake LLM / signals / memory / confirm hook.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AdapterRegistry } from '../lib/application/adapters/adapter-registry.js'
import { AutonomyLoop } from '../lib/application/autonomy/autonomy-loop.js'
import { DefaultAutonomyPolicy } from '../lib/application/autonomy/default-autonomy-policy.js'
import { JsonMemory } from '../lib/infrastructure/memory/json-memory.js'

const out = join(process.cwd(), 'data', 'voice-test', 'autonomy-smoke.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

// ---- fakes ----
class FakeAdapter {
  constructor(id, capabilities, methods) {
    this.id = id
    this.displayName = id
    this.packageName = `com.fake.${id}`
    this.capabilities = new Set(capabilities)
    this.todos = []
    this.calls = []
    for (const [name] of Object.entries(methods)) {
      this[name] = async (input) => {
        this.calls.push({ name, input })
        return { ok: true, detail: `${id}.${name} ok` }
      }
    }
  }
  async initialize() {}
}

const cannedDecisions = [
  // 1: whitelisted auto action (3-part key qq/moment/publishMoment)
  { intent: 'act', app: 'qq', capability: 'moment', method: 'publishMoment', args: { text: 'hello from autonomy' }, reason: 'post a moment' },
  // 2: cross-app whitelisted (2-part key message/sendMessage) -> auto, no confirm
  { intent: 'act', app: 'qq', capability: 'message', method: 'sendMessage', args: { peer: 'alice', text: 'hi' }, reason: 'dm alice' },
  // 3: forbidden (social/mention) -> confirm, never executes
  { intent: 'act', app: 'qq', capability: 'social', method: 'mention', args: { friend: 'bob' }, reason: 'mention bob' },
  // 4: illegal — app not registered
  { intent: 'act', app: 'ghost', capability: 'moment', method: 'publishMoment', args: {}, reason: 'unknown app' },
  // 5: idle
  { intent: 'idle', reason: 'nothing to do' },
]

class FakeLlm {
  constructor() { this.i = 0 }
  async decide() { throw new Error('decide() not used by autonomy loop') }
  async chat() {
    const d = cannedDecisions[this.i++]
    return JSON.stringify(d)
  }
}

const confirmCalls = []
const fakeConfirm = {
  async confirmRequired(decision, reason) {
    confirmCalls.push({ decision, reason })
  },
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'bf-autonomy-'))
  const memory = new JsonMemory(join(tmp, 'memory.json'))

  const qq = new FakeAdapter(
    'qq',
    ['moment', 'message', 'social'],
    {
      publishMoment: null,
      sendMessage: null,
      mention: null,
    },
  )
  const douyin = new FakeAdapter('douyin', ['feed'], { browseFeed: null })
  const registry = new AdapterRegistry()
  registry.register(qq)
  registry.register(douyin)

  const policy = new DefaultAutonomyPolicy({
    guardEnabled: true,
    autoActions: [
      'douyin/feed/browseFeed',
      'qq/moment/publishMoment',
      'message/sendMessage',
      'signin/signIn',
    ],
    forbiddenActions: [
      'message/sendImage',
      'social/mention',
      'comment/comment',
      'comment/replyComment',
      'game/runGame',
      'live/watchLive',
    ],
  })

  const signals = {
    async collect() {
      return {
        notifications: ['com.tencent.mobileqq: Alice: ping'],
        now: new Date().toISOString(),
        memory: ['event: prior boot'],
      }
    },
  }

  const loop = new AutonomyLoop({
    memory,
    llm: new FakeLlm(),
    registry,
    signals,
    policy,
    confirm: fakeConfirm,
  })

  // ---- round 1: 3-part auto executes ----
  const r1 = await loop.runOnce()
  say('round1 =', JSON.stringify(r1))
  if (!r1.decided || !r1.executed || r1.confirmed || r1.skipped) {
    throw new Error('round1 expected decided+executed, got ' + JSON.stringify(r1))
  }
  if (qq.calls.length !== 1 || qq.calls[0].name !== 'publishMoment') {
    throw new Error('round1 expected publishMoment called once, got ' + JSON.stringify(qq.calls))
  }
  if (qq.calls[0].input?.text !== 'hello from autonomy') {
    throw new Error('round1 args not passed through: ' + JSON.stringify(qq.calls[0].input))
  }
  if (confirmCalls.length !== 0) throw new Error('round1 should not confirm')

  // ---- round 2: 2-part key message/sendMessage -> auto, executes, no confirm ----
  const r2 = await loop.runOnce()
  say('round2 =', JSON.stringify(r2))
  if (!r2.decided || !r2.executed || r2.confirmed || r2.skipped) {
    throw new Error('round2 expected decided+executed (sendMessage auto), got ' + JSON.stringify(r2))
  }
  if (qq.calls.length !== 2 || qq.calls[1].name !== 'sendMessage') {
    throw new Error('round2 expected sendMessage called once, got ' + JSON.stringify(qq.calls))
  }
  if (confirmCalls.length !== 0) throw new Error('round2 should not confirm (sendMessage is auto)')

  // ---- round 3: forbidden social/mention -> confirm, no execution ----
  const callsBefore3 = qq.calls.length
  const r3 = await loop.runOnce()
  say('round3 =', JSON.stringify(r3))
  if (!r3.decided || r3.executed || !r3.confirmed || r3.skipped) {
    throw new Error('round3 expected decided+confirmed, got ' + JSON.stringify(r3))
  }
  if (qq.calls.length !== callsBefore3) throw new Error('round3 must NOT execute mention')
  if (confirmCalls.length !== 1) throw new Error('round3 expected one confirm call, got ' + confirmCalls.length)
  if (confirmCalls[0].decision.capability !== 'social' || confirmCalls[0].decision.method !== 'mention') {
    throw new Error('round3 confirm carries wrong decision: ' + JSON.stringify(confirmCalls[0].decision))
  }

  // ---- round 4: illegal app -> skip, no confirm, no exec ----
  const callsBefore4 = qq.calls.length
  const confirmsBefore4 = confirmCalls.length
  const r4 = await loop.runOnce()
  say('round4 =', JSON.stringify(r4))
  if (!r4.decided || r4.executed || r4.confirmed || !r4.skipped) {
    throw new Error('round4 expected decided+skipped, got ' + JSON.stringify(r4))
  }
  if (qq.calls.length !== callsBefore4) throw new Error('round4 must NOT execute')
  if (confirmCalls.length !== confirmsBefore4) throw new Error('round4 must NOT confirm')

  // ---- round 5: idle ----
  const callsBefore5 = qq.calls.length
  const confirmsBefore5 = confirmCalls.length
  const r5 = await loop.runOnce()
  say('round5 =', JSON.stringify(r5))
  if (!r5.decided || r5.executed || r5.confirmed || r5.skipped) {
    throw new Error('round5 expected decided+idle, got ' + JSON.stringify(r5))
  }
  if (qq.calls.length !== callsBefore5) throw new Error('round5 must NOT execute')
  if (confirmCalls.length !== confirmsBefore5) throw new Error('round5 must NOT confirm')

  // ---- lessons written ----
  const lessons = await memory.recall('autonomy', 10, 'lesson')
  say('lessons recorded =', lessons.length)
  say('lesson sample =', lessons[0]?.content ?? '(none)')
  if (lessons.length < 3) throw new Error('expected at least 3 lessons (2 ok + 1 confirm), got ' + lessons.length)

  say('SMOKE_OK')
}

main().then(() => {
  mkdirSync(join(process.cwd(), 'data', 'voice-test'), { recursive: true })
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
}).catch(err => {
  log.push('SMOKE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  mkdirSync(join(process.cwd(), 'data', 'voice-test'), { recursive: true })
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  process.exitCode = 1
})
