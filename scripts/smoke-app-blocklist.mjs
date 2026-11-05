// Smoke test for AppBlocklistFilter and pipeline ordering with WhitelistFilter.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { NotificationPipeline } from '../lib/application/notifications/pipeline.js'
import {
  AppBlocklistFilter,
  WhitelistFilter,
} from '../lib/application/notifications/filters.js'

const out = join(process.cwd(), 'data', 'voice-test', 'app-blocklist-smoke.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

const blockedApps = new Set(['com.sina.weibo', 'com.xingin.xhs', 'com.phoenix.read'])
const ev = app => ({
  id: 'x', app, title: 'any', text: 'any', when: Date.now(),
  importance: 3, source: 'http',
})

const main = async () => {
  // 1. direct filter behaviour
  const f = new AppBlocklistFilter(blockedApps)
  const d1 = await f.apply(ev('com.sina.weibo'))
  say('weibo blocked:', d1?.action, d1?.reason, d1?.matchedRule)
  const d2 = await f.apply(ev('com.smile.gifmaker'))
  say('kuaishou untouched:', d2 === null)
  if (d1?.action !== 'block' || d1.reason !== 'app-blocklist') throw new Error('weibo not blocked')
  if (d2 !== null) throw new Error('kuaishou wrongly blocked')

  // 2. real default assembly: whitelist empty + blockedApps default set
  const pipe = new NotificationPipeline([
    new WhitelistFilter(new Set()),
    new AppBlocklistFilter(blockedApps),
  ])
  const p1 = await pipe.decide(ev('com.smile.gifmaker'))
  say('kuaishou allow:', p1.action === 'allow')
  const p2 = await pipe.decide(ev('com.xingin.xhs'))
  say('xhs blocked by pipeline:', p2.action, p2.reason)
  const p3 = await pipe.decide(ev('com.phoenix.read'))
  say('phoenix blocked by pipeline:', p3.action, p3.reason)
  if (p1.action !== 'allow') throw new Error('kuaishou not allowed')
  if (p2.action !== 'block' || p2.reason !== 'app-blocklist') throw new Error('pipeline blocklist failed for xhs')
  if (p3.action !== 'block' || p3.reason !== 'app-blocklist') throw new Error('pipeline blocklist failed for phoenix')

  say('SMOKE_OK')
}

main().then(() => {
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
}).catch(err => {
  log.push('SMOKE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  process.exitCode = 1
})
