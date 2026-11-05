// Smoke test for AutonomyDriver (self-scheduling + event-driven + clamp):
//   1. LLM self-report nextWakeMs=X -> scheduler.scheduleNext(X)
//   2. LLM omits nextWakeMs -> scheduleNext(fallbackWakeMs)
//   3. nextWakeMs=0 -> clamped to min; nextWakeMs=huge -> clamped to max
//   4. event wake() immediately runs a tick
//   5. busy lock: while a slow runOnce is in flight, multiple wake() calls
//      collapse to a single queued tick; no concurrent runOnce
//   6. wakeOnEvent=false -> event wakes are ignored
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { AutonomyDriver } from '../lib/application/autonomy/autonomy-driver.js'

const out = join(process.cwd(), 'data', 'voice-test', 'autonomy-schedule-smoke.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

// Fake scheduler: records every scheduleNext call, no real timers.
class FakeScheduler {
  constructor() { this.calls = []; this.started = false; this.stopped = false }
  start() { this.started = true }
  stop() { this.stopped = true }
  scheduleNext(ms) { this.calls.push(ms) }
}

// Resolve a tick manually so we control when runOnce finishes.
function deferredLoop(result) {
  const calls = { count: 0, concurrent: 0, maxConcurrent: 0 }
  let resolveTick
  let tickP = new Promise(res => { resolveTick = res })
  const loop = {
    async runOnce() {
      calls.count++
      calls.concurrent++
      calls.maxConcurrent = Math.max(calls.maxConcurrent, calls.concurrent)
      try {
        return await tickP
      } finally {
        calls.concurrent--
      }
    },
  }
  return {
    loop,
    calls,
    release(resultOverride) {
      resolveTick(resultOverride ?? result)
      tickP = new Promise(res => { resolveTick = res })
    },
  }
}

async function main() {
  // ---------- 1. self-report nextWakeMs=60000 ----------
  {
    const sched = new FakeScheduler()
    const env = deferredLoop({ decided: true, executed: false, confirmed: false, skipped: false, nextWakeMs: 60000 })
    const driver = new AutonomyDriver({
      loop: env.loop,
      scheduler: sched,
      config: { minWakeMs: 100, maxWakeMs: 600000, fallbackWakeMs: 300000, wakeOnEvent: true },
    })
    driver.wake('heartbeat')
    env.release()
    await new Promise(r => setImmediate(r))
    say('1. self-report scheduleNext =', JSON.stringify(sched.calls))
    if (sched.calls[sched.calls.length - 1] !== 60000) {
      throw new Error('case1 expected scheduleNext(60000), got ' + JSON.stringify(sched.calls))
    }
  }

  // ---------- 2. no nextWakeMs -> fallback ----------
  {
    const sched = new FakeScheduler()
    const env = deferredLoop({ decided: true, executed: false, confirmed: false, skipped: false })
    const driver = new AutonomyDriver({
      loop: env.loop,
      scheduler: sched,
      config: { minWakeMs: 100, maxWakeMs: 600000, fallbackWakeMs: 300000, wakeOnEvent: true },
    })
    driver.wake('heartbeat')
    env.release()
    await new Promise(r => setImmediate(r))
    say('2. fallback scheduleNext =', JSON.stringify(sched.calls))
    if (sched.calls[sched.calls.length - 1] !== 300000) {
      throw new Error('case2 expected scheduleNext(300000 fallback), got ' + JSON.stringify(sched.calls))
    }
  }

  // ---------- 3. clamp to min and max ----------
  {
    const sched = new FakeScheduler()
    // First tick: nextWakeMs=0 -> clamp up to min=100
    const env = deferredLoop({ decided: true, executed: false, confirmed: false, skipped: false, nextWakeMs: 0 })
    const driver = new AutonomyDriver({
      loop: env.loop,
      scheduler: sched,
      config: { minWakeMs: 100, maxWakeMs: 600000, fallbackWakeMs: 300000, wakeOnEvent: true },
    })
    driver.wake('heartbeat')
    env.release()
    await new Promise(r => setImmediate(r))
    say('3a. nextWakeMs=0 ->', sched.calls[sched.calls.length - 1])
    if (sched.calls[sched.calls.length - 1] !== 100) throw new Error('case3a expected 100')

    // Second tick: nextWakeMs=99999999 -> clamp down to max=600000
    driver.wake('heartbeat')
    env.release({ decided: true, executed: false, confirmed: false, skipped: false, nextWakeMs: 99999999 })
    await new Promise(r => setImmediate(r))
    say('3b. nextWakeMs=99999999 ->', sched.calls[sched.calls.length - 1])
    if (sched.calls[sched.calls.length - 1] !== 600000) throw new Error('case3b expected 600000')
  }

  // ---------- 4. event wake triggers immediately ----------
  {
    const sched = new FakeScheduler()
    const env = deferredLoop({ decided: true, executed: false, confirmed: false, skipped: false, nextWakeMs: 30000 })
    const driver = new AutonomyDriver({
      loop: env.loop,
      scheduler: sched,
      config: { minWakeMs: 100, maxWakeMs: 600000, fallbackWakeMs: 300000, wakeOnEvent: true },
    })
    const before = env.calls.count
    driver.onAllowEvent()
    // Loop should be running synchronously up to its first await.
    if (env.calls.count !== before + 1) throw new Error('case4 event did not trigger immediate runOnce')
    env.release()
    await new Promise(r => setImmediate(r))
    say('4. event-triggered runOnce count =', env.calls.count - before)
  }

  // ---------- 5. busy lock: collapse to one pending ----------
  {
    const sched = new FakeScheduler()
    const env = deferredLoop({ decided: true, executed: false, confirmed: false, skipped: false, nextWakeMs: 5000 })
    const driver = new AutonomyDriver({
      loop: env.loop,
      scheduler: sched,
      config: { minWakeMs: 100, maxWakeMs: 600000, fallbackWakeMs: 300000, wakeOnEvent: true },
    })
    // Start a slow tick.
    driver.wake('heartbeat')
    const runningCount = env.calls.count
    if (runningCount !== 1) throw new Error('case5 expected first tick running')
    // Fire many wakes while busy; they should collapse.
    driver.wake('event')
    driver.wake('event')
    driver.wake('heartbeat')
    driver.onAllowEvent()
    await new Promise(r => setImmediate(r))
    if (env.calls.count !== 1) throw new Error('case5 expected no concurrent second tick, got count=' + env.calls.count)
    if (env.calls.maxConcurrent !== 1) throw new Error('case5 expected maxConcurrent=1')
    // Release the first tick; the queued one should fire.
    env.release()
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))
    say('5. ticks after collapse =', env.calls.count, 'maxConcurrent =', env.calls.maxConcurrent)
    if (env.calls.count !== 2) throw new Error('case5 expected exactly one queued follow-up, got ' + env.calls.count)
  }

  // ---------- 6. wakeOnEvent=false ignores events ----------
  {
    const sched = new FakeScheduler()
    const env = deferredLoop({ decided: true, executed: false, confirmed: false, skipped: false, nextWakeMs: 30000 })
    const driver = new AutonomyDriver({
      loop: env.loop,
      scheduler: sched,
      config: { minWakeMs: 100, maxWakeMs: 600000, fallbackWakeMs: 300000, wakeOnEvent: false },
    })
    driver.onAllowEvent()
    if (env.calls.count !== 0) throw new Error('case6 event should be ignored when wakeOnEvent=false')
    // heartbeat still works.
    driver.wake('heartbeat')
    env.release()
    await new Promise(r => setImmediate(r))
    say('6. heartbeat still runs with wakeOnEvent=false, count =', env.calls.count)
    if (env.calls.count !== 1) throw new Error('case6 heartbeat should still fire')
  }

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
