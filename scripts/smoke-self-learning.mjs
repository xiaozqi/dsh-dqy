// Smoke test for self-directed learning: diary idempotency, self-authored
// goals from decisions, and strategy/diary injection into the signal bundle.
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { JsonMemory } from '../lib/infrastructure/memory/json-memory.js'
import { DiaryWriter, localDayKey } from '../lib/application/autonomy/diary-writer.js'
import { AutonomyLoop } from '../lib/application/autonomy/autonomy-loop.js'

const dir = resolve('data/smoke-self-learning')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const failures = []
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''))
  if (!cond) failures.push(name)
}

function fakeLlm(responses) {
  let i = 0
  return {
    async chat() { return responses[Math.min(i++, responses.length - 1)] },
    async chatJson() { return responses[Math.min(i++, responses.length - 1)] },
  }
}

// ---- T1: diary written once per day, strategies stored, then idempotent ----
{
  const memory = new JsonMemory(resolve(dir, 'm1.json'))
  await memory.remember({ kind: 'event', content: 'Douyin feed session: watched 10, liked 2', tags: ['event'] })
  await memory.remember({ kind: 'lesson', content: 'autonomy ok: douyin/feed/browseFeed', tags: ['lesson'] })
  const llm = fakeLlm(['{"diary":"今天认真刷了抖音，点赞手感不错，还学会了先看清楚再点。","strategies":["browse a batch then like selectively","check foreground app before acting"]}'])
  const writer = new DiaryWriter({ llm, memory })
  const wrote = await writer.writeIfDue(new Date())
  check('T1 diary written', wrote === true)
  const recs = await memory.recent(50)
  const day = localDayKey(new Date())
  const diary = recs.find(r => r.kind === 'diary' && r.tags.includes(day))
  check('T1 diary record tagged with day', !!diary, diary ? diary.content.slice(0, 40) : 'none')
  const strategies = recs.filter(r => r.kind === 'strategy')
  check('T1 strategies stored', strategies.length === 2, 'count=' + strategies.length)
  const again = await writer.writeIfDue(new Date())
  check('T1 second call idempotent (no rewrite)', again === false)
  const after = await memory.recent(50)
  check('T1 still exactly one diary', after.filter(r => r.kind === 'diary').length === 1)
}

// ---- T2: decision with newGoal becomes a stored goal ----
{
  const memory = new JsonMemory(resolve(dir, 'm2.json'))
  const llm = fakeLlm(['{"intent":"idle","reason":"planning my learning path","newGoal":"learn to send one friendly QQ message to a close friend","nextWakeMs":120000}'])
  const registry = {
    list: () => [{ id: 'douyin', capabilities: new Set(['feed']) }],
    get: () => { throw new Error('not used') },
  }
  const loop = new AutonomyLoop({
    memory,
    llm,
    registry: registry,
    signals: { async collect() { return { notifications: [], now: new Date().toISOString(), memory: [] } } },
    policy: { classify: () => 'auto' },
  })
  const r = await loop.runOnce()
  check('T2 tick idle parsed', r.decided === true && r.skipped === false, JSON.stringify({ decided: r.decided, nextWakeMs: r.nextWakeMs }))
  const goals = (await memory.recent(20)).filter(x => x.kind === 'goal')
  check('T2 self goal stored', goals.length === 1 && goals[0].content.includes('QQ message'), goals[0] ? goals[0].content : 'none')
  check('T2 goal tagged self-directed', !!goals[0] && goals[0].tags.includes('self-directed'))
}

// ---- T3: too-short newGoal is dropped ----
{
  const memory = new JsonMemory(resolve(dir, 'm3.json'))
  const llm = fakeLlm(['{"intent":"idle","reason":"x","newGoal":"ok"}'])
  const loop = new AutonomyLoop({
    memory,
    llm,
    registry: { list: () => [], get: () => { throw new Error('no') } },
    signals: { async collect() { return { notifications: [], now: new Date().toISOString(), memory: [] } } },
    policy: { classify: () => 'auto' },
  })
  await loop.runOnce()
  const goals = (await memory.recent(20)).filter(x => x.kind === 'goal')
  check('T3 short newGoal dropped', goals.length === 0)
}

// ---- T4: diary failure is isolated (llm throws => loop still returns) ----
{
  const memory = new JsonMemory(resolve(dir, 'm4.json'))
  await memory.remember({ kind: 'event', content: 'event a', tags: ['event'] })
  await memory.remember({ kind: 'event', content: 'event b', tags: ['event'] })
  const llm = {
    async chat() { throw new Error('boom') },
    async chatJson() { throw new Error('boom') },
  }
  const writer = new DiaryWriter({ llm, memory })
  const wrote = await writer.writeIfDue(new Date())
  check('T4 llm failure => false, no throw', wrote === false)
  const recs = await memory.recent(20)
  check('T4 no bogus diary on failure', recs.filter(r => r.kind === 'diary').length === 0)
}

rmSync(dir, { recursive: true, force: true })
if (failures.length) {
  console.log('SMOKE_SELF_LEARNING_FAIL: ' + failures.join(', '))
  process.exit(1)
}
console.log('SMOKE_SELF_LEARNING_OK')
