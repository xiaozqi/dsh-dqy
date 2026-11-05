// Verify that the out-of-the-box config blocks junk notifications:
// Config with no user-supplied rules must fall back to the default junk rules,
// a matching notification is blocked and queued for cancel, a normal one is not.
import { writeFileSync } from 'node:fs'
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
import { Config } from '../lib/index.js'

const out = join(process.cwd(), 'data', 'voice-test', 'default-rules.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

const PORT = 14201

async function main() {
  // Config() with no arguments yields the schema defaults, including the junk rules.
  const cfg = Config()
  const defaults = cfg.notifications.rules
  say('default rule count =', defaults.length)
  for (const r of defaults) say('  rule:', r.pattern, '->', r.action)

  const http = new HttpNotificationSource(PORT, join(tmpdir(), 'dr.log'))
  const pipeline = new NotificationPipeline([
    new WhitelistFilter(new Set()),
    new ImportanceFilter(cfg.notifications.minImportance),
    new RuleFilter(
      defaults.map(r => ({
        match: new RegExp(r.pattern, r.caseSensitive ? '' : 'i'),
        action: r.action,
      })),
    ),
    new SemanticFilter(null, false),
    new DedupeFilter(cfg.notifications.dedupeWindowMs),
  ])
  const svc = new NotificationService([http], pipeline, 100, http)
  await svc.start()

  // junk titles that must be blocked by defaults
  const junk = [
    { title: '限时特惠大促5折', text: '全场五折速抢', id: 'k-junk-1' },
    { title: '你中奖了', text: '点击领红包', id: 'k-junk-2' },
    { title: '兼职日结300', text: '加微信', id: 'k-junk-3' },
  ]
  for (const e of junk) {
    const res = await fetch(`http://127.0.0.1:${PORT}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app: 'tv.danmaku.bili', title: e.title, text: e.text,
        when: Date.now(), id: e.id,
      }),
    })
    say('junk POST', e.id, 'status =', res.status)
  }

  // normal titles that must survive
  const normal = [
    { title: '普通消息提醒', text: '第二条普通消息', id: 'k-ok-1' },
    { title: 'Alice', text: 'are you there', id: 'k-ok-2' },
  ]
  for (const e of normal) {
    const res = await fetch(`http://127.0.0.1:${PORT}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app: 'com.tencent.mobileqq', title: e.title, text: e.text,
        when: Date.now(), id: e.id,
      }),
    })
    say('normal POST', e.id, 'status =', res.status)
  }

  await new Promise(resolve => setTimeout(resolve, 500))
  const stats = svc.stats()
  say('stats =', JSON.stringify(stats))
  if (stats.blocked !== 3 || stats.allowed !== 2) {
    throw new Error(`expected blocked=3 allowed=2, got ${JSON.stringify(stats)}`)
  }

  const poll = await (await fetch(`http://127.0.0.1:${PORT}/api/pending-cancels`)).json()
  say('pending cancels =', JSON.stringify(poll.cancels))
  const want = JSON.stringify(['k-junk-1', 'k-junk-2', 'k-junk-3'])
  if (JSON.stringify(poll.cancels) !== want) {
    throw new Error(`cancel queue mismatch: ${JSON.stringify(poll.cancels)}`)
  }

  await svc.stop()
  say('SMOKE_OK')
}

import { tmpdir } from 'node:os'
main().then(() => {
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
}).catch(err => {
  log.push('SMOKE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  process.exitCode = 1
})
