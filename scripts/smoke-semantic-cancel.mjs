// Smoke for the semantic (LLM) layer of the notification cancel loop:
// - with semantic enabled, a promo title the keyword rules do NOT match is
//   blocked by the semantic judge and queued for cancel, with stats and
//   cancel-log entries updated;
// - a relevant title passes;
// - a failing / unusable judge degrades to the remaining layers (never blocks
//   the pipeline), and non-JSON replies are treated as relevant (allow).
// The LLM port is mocked here; the APK / real LLM path shares the same code.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import { Config } from '../lib/index.js'

const out = join(process.cwd(), 'data', 'voice-test', 'semantic-cancel-smoke.txt')
const log = []
const say = (...a) => log.push(a.map(String).join(' '))

const PORT = 14203

async function post(port, event) {
  const res = await fetch(`http://127.0.0.1:${port}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
  return res.status
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'bf-semantic-'))
  const cfg = Config()

  // judge that behaves as programmed
  let mode = 'irrelevant'
  const mockLlm = {
    async chat() {
      if (mode === 'irrelevant') return '{"relevant":false}'
      if (mode === 'relevant') return '{"relevant":true}'
      if (mode === 'throw') throw new Error('llm offline')
      return 'server busy, try later'
    },
  }

  const http = new HttpNotificationSource(PORT, join(tmp, 'received.log'))
  const pipeline = new NotificationPipeline([
    new WhitelistFilter(new Set()),
    new ImportanceFilter(cfg.notifications.minImportance),
    new RuleFilter(
      cfg.notifications.rules.map(r => ({
        match: new RegExp(r.pattern, r.caseSensitive ? '' : 'i'),
        action: r.action,
      })),
    ),
    new SemanticFilter(mockLlm, true),
    new DedupeFilter(cfg.notifications.dedupeWindowMs),
  ])
  const svc = new NotificationService(
    [http],
    pipeline,
    100,
    http,
    join(tmp, 'cancel.log'),
  )
  await svc.start()

  // 1. promo wording the keyword rules do NOT match -> semantic block
  await post(PORT, {
    app: 'tv.danmaku.bili', title: '好物推荐 今天给家人挑点东西', text: '点击查看详情',
    when: Date.now(), id: 'k-sem-block',
  })

  // 2. relevant title -> semantic allow
  mode = 'relevant'
  await post(PORT, {
    app: 'com.tencent.mobileqq', title: 'Alice', text: 'are you there',
    when: Date.now(), id: 'k-sem-allow',
  })

  // 3. judge throws -> degrade: must not block, pipeline keeps working
  mode = 'throw'
  await post(PORT, {
    app: 'com.tencent.mobileqq', title: 'Bob', text: 'see you tomorrow',
    when: Date.now(), id: 'k-degrade',
  })

  // 4. judge returns non-JSON -> parsed as relevant (allow)
  mode = 'garbage'
  await post(PORT, {
    app: 'com.tencent.mobileqq', title: 'Carol', text: 'lunch?',
    when: Date.now(), id: 'k-garbage',
  })

  // 5. keyword rule still blocks independent of semantic mode
  mode = 'relevant'
  await post(PORT, {
    app: 'tv.danmaku.bili', title: '限时特惠大促5折', text: '全场五折速抢',
    when: Date.now(), id: 'k-rule-block',
  })

  await new Promise(resolve => setTimeout(resolve, 500))
  const stats = svc.stats()
  say('stats =', JSON.stringify(stats))
  // semantic blocked 1, semantic allowed 1, degrade allowed 1, garbage allowed 1, rule blocked 1
  if (stats.blocked !== 2 || stats.allowed !== 3 || stats.canceled !== 2) {
    throw new Error(
      `expected blocked=2 allowed=3 canceled=2, got ${JSON.stringify(stats)}`,
    )
  }
  if (stats.droppedBy.semantic !== 1 || stats.droppedBy.rules !== 1) {
    throw new Error('droppedBy mismatch: ' + JSON.stringify(stats.droppedBy))
  }

  const poll = await (
    await fetch(`http://127.0.0.1:${PORT}/api/pending-cancels`)
  ).json()
  say('pending cancels =', JSON.stringify(poll.cancels))
  const want = JSON.stringify(['k-sem-block', 'k-rule-block'])
  if (JSON.stringify(poll.cancels) !== want) {
    throw new Error('cancel queue mismatch: ' + JSON.stringify(poll.cancels))
  }

  const cancelLines = readFileSync(join(tmp, 'cancel.log'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  say('cancel log lines =', cancelLines.length)
  if (cancelLines.length !== 2) throw new Error('cancel log must have 2 lines')
  const [first, second] = cancelLines
  if (first.actor !== 'plugin' || first.key !== 'k-sem-block' || first.reason !== 'semantic') {
    throw new Error('semantic cancel log entry mismatch: ' + JSON.stringify(first))
  }
  if (second.key !== 'k-rule-block' || second.reason !== 'rules' || second.matchedRule !== '限时特惠|限时优惠|特惠|大促|秒杀|清仓') {
    throw new Error('rule cancel log entry mismatch: ' + JSON.stringify(second))
  }

  await svc.stop()
  say('SMOKE_OK')
}

main().then(() => {
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
}).catch(err => {
  log.push('SMOKE_FAIL: ' + (err && err.stack ? err.stack : String(err)))
  writeFileSync(out, log.join('\n') + '\n', 'utf8')
  process.exitCode = 1
})
