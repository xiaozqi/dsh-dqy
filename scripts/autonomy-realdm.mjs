// Real-DeepSeek decision probe for the autonomy loop: one heartbeat with a
// REAL LLM (deepseek-chat, key read from data/secrets.local.json).
// Safety: adapters are fakes so NOTHING touches the phone or any real
// account; the API key is never echoed; signals are synthetic; the report
// is written to a local file only.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AdapterRegistry } from '../lib/application/adapters/adapter-registry.js'
import { AutonomyLoop } from '../lib/application/autonomy/autonomy-loop.js'
import { DefaultAutonomyPolicy } from '../lib/application/autonomy/default-autonomy-policy.js'
import { HttpLlm } from '../lib/infrastructure/llm/http-llm.js'
import { JsonMemory } from '../lib/infrastructure/memory/json-memory.js'
import { Config } from '../lib/index.js'

const out = join(process.cwd(), 'data', 'voice-test', 'autonomy-realdm.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

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
        return { ok: true, detail: `${id}.${name} ok (fake)` }
      }
    }
  }
  async initialize() {}
}

async function main() {
  const cfg = Config()
  const secretsRaw = readFileSync(join(process.cwd(), 'data', 'secrets.local.json'), 'utf8')
  const key = (JSON.parse(secretsRaw).deepseekApiKey || '').trim()
  if (!key) throw new Error('no deepseekApiKey in data/secrets.local.json')
  const masked = key.slice(0, 6) + '…' + key.slice(-4)
  say('llm = deepseek-chat (' + cfg.llmBaseUrl + ') key=' + masked)

  const llm = new HttpLlm({
    baseUrl: cfg.llmBaseUrl,
    apiKey: key,
    model: cfg.llmModel,
    timeoutMs: cfg.llmTimeoutMs ?? 30000,
  })

  const tmp = mkdtempSync(join(tmpdir(), 'bf-realdm-'))
  const memory = new JsonMemory(join(tmp, 'memory.json'))
  await memory.remember({
    kind: 'task',
    content: 'daily check-in: do signIn once per day if not done yet',
    tags: ['task', 'signin'],
  })
  await memory.remember({
    kind: 'lesson',
    content: 'autonomy ok: qq/moment/publishMoment | reason=user liked previous post | detail=posting moments is welcome',
    tags: ['lesson', 'autonomy'],
  })

  const registry = new AdapterRegistry()
  registry.register(new FakeAdapter('qq', ['moment', 'message', 'social'], { publishMoment: null, sendMessage: null, mention: null }))
  registry.register(new FakeAdapter('douyin', ['feed'], { browseFeed: null }))
  registry.register(new FakeAdapter('weibo', ['signin'], { signIn: null }))

  const policy = new DefaultAutonomyPolicy({
    guardEnabled: cfg.autonomy.guardEnabled,
    autoActions: cfg.autonomy.autoActions,
    forbiddenActions: cfg.autonomy.forbiddenActions,
  })
  say('policy auto =', JSON.stringify(cfg.autonomy.autoActions))
  say('policy forbidden =', JSON.stringify(cfg.autonomy.forbiddenActions))

  const signals = {
    async collect() {
      return {
        notifications: [],
        now: new Date().toISOString(),
        memory: (await memory.recall('task', 5)).map(m => m.content),
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

  say('--- heartbeat ---')
  const r = await loop.runOnce()
  say('tick =', JSON.stringify({ decided: r.decided, executed: r.executed, confirmed: r.confirmed, skipped: r.skipped, error: r.error }))
  if (r.decision) say('decision =', JSON.stringify(r.decision))
  say('fake calls =', JSON.stringify([...registry.adapters].flatMap(a => (a.calls || []).map(c => `${a.id}/${c.name}`))))
  say('confirm calls =', confirmCalls.length)

  if (!r.decided) {
    say('REALDM_FAIL parse/skip, error=' + String(r.error))
    throw new Error('no decision from real LLM: ' + String(r.error))
  }
  const lessons = await memory.recall('autonomy', 10, 'lesson')
  say('lessons =', lessons.length)
  say('REALDM_OK decided=' + r.decided + ' executed=' + r.executed + ' confirmed=' + r.confirmed)
}

main().then(() => {
  mkdirSync(join(process.cwd(), 'data', 'voice-test'), { recursive: true })
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  console.log(log.join('\n'))
}).catch(err => {
  log.push('REALDM_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  mkdirSync(join(process.cwd(), 'data', 'voice-test'), { recursive: true })
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  console.log(log.join('\n'))
  process.exitCode = 1
})
