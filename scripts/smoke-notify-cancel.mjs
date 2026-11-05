// Smoke test for the notification cancel closed loop:
// a block decision must land in the HttpNotificationSource cancel queue and be
// served (and drained) by GET /api/pending-cancels.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NotificationPipeline } from '../lib/application/notifications/pipeline.js'
import { NotificationService } from '../lib/application/notifications/notification.service.js'
import {
  DedupeFilter,
  ImportanceFilter,
  RuleFilter,
  SemanticFilter,
  WhitelistFilter,
} from '../lib/application/notifications/filters.js'
import { HttpNotificationSource } from '../lib/infrastructure/notifications/http-notification-source.js'

const out = join(process.cwd(), 'data', 'voice-test', 'notify-cancel-smoke.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

const PORT = 14199

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'bf-notif-cancel-'))
  const http = new HttpNotificationSource(PORT, join(tmp, 'received.log'))
  const pipeline = new NotificationPipeline([
    new WhitelistFilter(new Set()),
    new ImportanceFilter(2),
    new RuleFilter([{ match: /广告/, action: 'block' }]),
    new SemanticFilter(null, false),
    new DedupeFilter(600000),
  ])
  const svc = new NotificationService([http], pipeline, 100, http)
  await svc.start()
  say('http connected =', http.connected)
  if (!http.connected) throw new Error('http source did not start')

  // block-decision event (title matches the block rule)
  const r1 = await post('/notify', {
    app: 'tv.danmaku.bili', title: 'VIP广告', text: 'click here',
    when: Date.now(), id: 'sbn-key-block-1',
  })
  say('POST block-event status =', r1.status)
  if (r1.status !== 200) throw new Error('block event POST not 200')

  // allow event: its key must NOT be pushed to the cancel queue
  const r2 = await post('/notify', {
    app: 'com.tencent.mobileqq', title: 'Alice', text: 'are you there',
    when: Date.now(), id: 'sbn-key-allow-1',
  })
  say('POST allow-event status =', r2.status)
  if (r2.status !== 200) throw new Error('allow event POST not 200')

  await new Promise(resolve => setTimeout(resolve, 400))
  say('stats =', JSON.stringify(svc.stats()))
  if (svc.stats().blocked !== 1 || svc.stats().allowed !== 1) {
    throw new Error('expected blocked=1 allowed=1')
  }

  // dedup: push the same block event again, dedupe filter blocks it too
  await post('/notify', {
    app: 'tv.danmaku.bili', title: 'VIP广告', text: 'click here',
    when: Date.now(), id: 'sbn-key-block-1',
  })
  await new Promise(resolve => setTimeout(resolve, 400))

  // first poll: must contain the block key once (deduped), allow key absent
  const g1 = await fetch(`http://127.0.0.1:${PORT}/api/pending-cancels`)
  const b1 = await g1.json()
  say('poll #1 =', JSON.stringify(b1))
  if (JSON.stringify(b1.cancels) !== JSON.stringify(['sbn-key-block-1'])) {
    throw new Error('pending cancels mismatch: ' + JSON.stringify(b1))
  }

  // second poll: queue must be drained
  const g2 = await fetch(`http://127.0.0.1:${PORT}/api/pending-cancels`)
  const b2 = await g2.json()
  say('poll #2 =', JSON.stringify(b2))
  if (b2.cancels.length !== 0) throw new Error('cancel queue not drained')

  await svc.stop()
  say('http connected after stop =', http.connected)
  say('SMOKE_OK')
}

main().then(() => {
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
}).catch(err => {
  log.push('SMOKE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  process.exitCode = 1
})
