// Smoke test for the learning feature (lesson memory + agent-loop learning hooks).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

import { JsonMemory } from '../lib/infrastructure/memory/json-memory.js'
import { AgentLoop } from '../lib/application/agent-loop.js'

const out = join(process.cwd(), 'data', 'voice-test', 'learning-smoke.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

const dir = mkdtempSync(join(tmpdir(), 'bf-mem-'))
const memFile = join(dir, 'memory.json')
const mem = new JsonMemory(memFile)

async function main() {
  // 1. JsonMemory lesson kind + kind-filtered recall
  await mem.remember({ kind: 'fact', content: 'user taps ads sometimes', tags: ['user'] })
  await mem.remember({ kind: 'lesson', content: 'avoid tapping ads with 118 links', tags: ['lesson'] })
  const onlyLesson = await mem.recall('tap ads', 10, 'lesson')
  const mixed = await mem.recall('tap ads', 10)
  say('onlyLesson count:', onlyLesson.length, 'kind:', onlyLesson[0]?.kind)
  say('mixed count:', mixed.length, 'kinds:', mixed.map(m => m.kind).join(','))
  if (onlyLesson.length !== 1 || onlyLesson[0].kind !== 'lesson') throw new Error('kind filter failed')
  if (mixed.length !== 2) throw new Error('mixed recall failed')

  // 2. AgentLoop learning: success path writes lesson, next run injects lessons
  const fakeDevice = {
    connect: async () => {},
    observe: async () => ({
      screenshotPath: 'x.png', foregroundApp: 'com.qq', screenSize: { width: 1080, height: 2310 },
      roots: [], capturedAt: new Date().toISOString(),
    }),
    tap: async () => {}, longPress: async () => {}, swipe: async () => {},
    inputText: async () => {}, pressKey: async () => {}, openApp: async () => {},
  }
  let decidedMessages = null
  let chatCalls = 0
  const fakeLlm = {
    decide: async messages => {
      decidedMessages = messages
      return { thought: 'ok', name: 'finish', args: { summary: 'done' } }
    },
    chat: async messages => {
      chatCalls += 1
      return '- always verify the send button is enabled before tapping'
    },
  }
  const fakeGuard = { checkStep: () => {}, checkAction: () => {} }
  const loop = new AgentLoop(fakeDevice, mem, fakeLlm, fakeGuard, 'persona')

  const r1 = await loop.run('send a message in qq')
  say('run1 completed:', r1.completed, 'steps:', r1.steps)
  const lessons = await mem.recall('send button', 10, 'lesson')
  say('lessons after run1:', lessons.length)
  if (lessons.length !== 1) throw new Error('expected 1 new lesson after success run')
  if (!lessons[0].content.includes('send button')) throw new Error('wrong lesson content')
  say('lesson content:', lessons[0].content)
  if (chatCalls !== 1) throw new Error('reflect should be called once on success')

  // run2: decidedMessages must include prior lessons
  const r2 = await loop.run('send a message in qq')
  const prior = decidedMessages.find(m => m.content && m.content.startsWith('[prior lessons'))
  say('run2 completed:', r2.completed, 'priorLessonsInjected:', Boolean(prior))
  if (!prior) throw new Error('prior lessons not injected on run2')

  // 3. Failure path writes lesson and rethrows
  const failingLlm = {
    decide: async () => { throw new Error('llm decide exploded') },
    chat: async () => '- when llm decide fails, retry with simpler goal',
  }
  const loop2 = new AgentLoop(fakeDevice, mem, failingLlm, fakeGuard, 'persona')
  let threw = false
  try { await loop2.run('do the impossible') } catch { threw = true }
  say('failure rethrown:', threw)
  const failLessons = await mem.recall('llm decide', 10, 'lesson')
  say('lesson after failure:', failLessons.length)
  if (!threw || failLessons.length < 1) throw new Error('failure learning failed')

  say('SMOKE_OK')
}

main().then(() => {
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
}).catch(err => {
  log.push('SMOKE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  process.exitCode = 1
})
