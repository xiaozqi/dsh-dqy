// Observation-mode autonomy run: REAL DeepSeek decisions + REAL policy
// grading + REAL lesson writes, but adapters are fakes so NO real message
// or post is ever sent and NO phone action happens. Run N heartbeats and
// print what the fish WOULD do each round. Key never echoed.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AdapterRegistry } from '../lib/application/adapters/adapter-registry.js'
import { AutonomyLoop } from '../lib/application/autonomy/autonomy-loop.js'
import { DefaultAutonomyPolicy } from '../lib/application/autonomy/default-autonomy-policy.js'
import { HttpLlm } from '../lib/infrastructure/llm/http-llm.js'
import { JsonMemory } from '../lib/infrastructure/memory/json-memory.js'
import { Config } from '../lib/index.js'

const ROUNDS = Number(process.env.AUTONOMY_ROUNDS ?? 6)
const GAP_MS = Number(process.env.AUTONOMY_GAP_MS ?? 45000)
const out = join(process.cwd(), 'data', 'voice-test', 'autonomy-run.log')
const log = []
const say = (...a) => log.push(new Date().toISOString() + ' ' + a.map(String).join(' '))

class FakeAdapter {
  constructor(id, capabilities) {
    this.id = id
    this.displayName = id
    this.packageName = `com.fake.${id}`
    this.capabilities = new Set(capabilities)
    this.todos = []
    for (const name of ['signIn', 'browseFeed', 'feedPet', 'publishMoment', 'mention', 'sendMessage', 'comment', 'runGame', 'watchLive']) {
      this[name] = async (input) => {
        say('  [fake]', `${id}.${name}`, JSON.stringify(input ?? {}))
        return { ok: true, detail: `${id}.${name} ok (simulated)` }
      }
    }
  }
  async initialize() {}
}

async function main() {
  const cfg = Config()
  const key = (JSON.parse(readFileSync(join(process.cwd(), 'data', 'secrets.local.json'), 'utf8')).deepseekApiKey || '').trim()
  if (!key) throw new Error('no deepseekApiKey')
  say('llm =', cfg.llmModel, cfg.llmBaseUrl, 'key=' + key.slice(0, 6) + '…' + key.slice(-4))
  say('policy auto =', JSON.stringify(cfg.autonomy.autoActions))
  say('policy forbidden =', JSON.stringify(cfg.autonomy.forbiddenActions))
  say('minWakeMs =', cfg.autonomy.minWakeMs, 'maxWakeMs =', cfg.autonomy.maxWakeMs, 'fallbackWakeMs =', cfg.autonomy.fallbackWakeMs)

  const llm = new HttpLlm({ baseUrl: cfg.llmBaseUrl, apiKey: key, model: cfg.llmModel, timeoutMs: cfg.llmTimeoutMs ?? 30000 })
  const tmp = mkdtempSync(join(tmpdir(), 'bf-autorun-'))
  const memory = new JsonMemory(join(tmp, 'memory.json'))
  await memory.remember({ kind: 'task', content: 'daily check-in: do signIn once per day if not done yet', tags: ['task', 'signin'] })
  await memory.remember({ kind: 'lesson', content: 'autonomy ok: qq/moment/publishMoment | reason=user liked previous post | detail=posting moments is welcome', tags: ['lesson', 'autonomy'] })
  await memory.remember({ kind: 'goal', content: 'be an active friend: browse feeds and like interesting posts occasionally', tags: ['goal', 'feed'] })

  const registry = new AdapterRegistry()
  registry.register(new FakeAdapter('qq', ['moment', 'message', 'social']))
  registry.register(new FakeAdapter('douyin', ['feed', 'comment', 'social', 'live', 'pet']))
  registry.register(new FakeAdapter('weibo', ['feed', 'social', 'signin', 'live']))
  registry.register(new FakeAdapter('xhs', ['feed', 'comment', 'social', 'signin', 'live']))
  registry.register(new FakeAdapter('alipay', ['signin', 'message', 'feed', 'live']))
  registry.register(new FakeAdapter('bilibili', ['feed', 'message', 'social', 'live']))
  registry.register(new FakeAdapter('game', ['game']))

  const policy = new DefaultAutonomyPolicy({
    guardEnabled: cfg.autonomy.guardEnabled,
    autoActions: cfg.autonomy.autoActions,
    forbiddenActions: cfg.autonomy.forbiddenActions,
  })

  const signals = {
    async collect() {
      const memHits = await memory.recall('goal todo lesson', 8)
      return {
        notifications: [],
        now: new Date().toISOString(),
        memory: memHits.map(h => `${h.kind}: ${h.content}`),
      }
    },
  }

  const confirmCalls = []
  const loop = new AutonomyLoop({
    memory,
    llm,
    registry,
    signals,
    policy,
    confirm: {
      async confirmRequired(decision, reason) {
        confirmCalls.push({ decision, reason })
      },
    },
  })

  let executed = 0
  let confirmed = 0
  let idle = 0
  let skipped = 0
  for (let i = 1; i <= ROUNDS; i++) {
    say(`--- round ${i}/${ROUNDS} ---`)
    const r = await loop.runOnce()
    if (r.decision) say('decision =', JSON.stringify(r.decision))
    if (r.executed) executed++
    if (r.confirmed) confirmed++
    if (!r.decision || (r.decision.intent === 'idle')) idle++
    if (r.skipped) skipped++
    say('tick =', JSON.stringify({ decided: r.decided, executed: r.executed, confirmed: r.confirmed, skipped: r.skipped, error: r.error }))
    if (i < ROUNDS) await new Promise(res => setTimeout(res, GAP_MS))
  }

  say('--- summary ---')
  say(`rounds=${ROUNDS} executed=${executed} confirmed=${confirmed} idle=${idle} skipped=${skipped}`)
  say('AUTONOMY_RUN_OK')
}

main().then(() => {
  mkdirSync(join(process.cwd(), 'data', 'voice-test'), { recursive: true })
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  console.log(log.join('\n'))
}).catch(err => {
  log.push('AUTONOMY_RUN_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  mkdirSync(join(process.cwd(), 'data', 'voice-test'), { recursive: true })
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  console.log(log.join('\n'))
  process.exitCode = 1
})
