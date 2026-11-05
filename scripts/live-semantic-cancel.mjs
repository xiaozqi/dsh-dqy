// Live semantic test: the same wiring as the main program but with a mock LLM
// judge that treats promo wording as irrelevant, so the semantic layer blocks a
// notification the keyword rules do NOT match. Serves :14123 for 600s.
import { resolve } from 'node:path'

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

const cfg = Config()
const http = new HttpNotificationSource(
  cfg.notifications.httpPort,
  resolve('data/notifications/live.log'),
)
const pipeline = new NotificationPipeline([
  new WhitelistFilter(new Set(cfg.notifications.whitelist)),
  new ImportanceFilter(cfg.notifications.minImportance),
  new RuleFilter(
    cfg.notifications.rules.map(r => ({
      match: new RegExp(r.pattern, r.caseSensitive ? '' : 'i'),
      action: r.action,
    })),
  ),
  // mock judge: promo-flavoured wording is irrelevant (block), anything else
  // with an @-mention marker is relevant (allow) - keeps normal notifications
  // alive while exercising the semantic path end to end.
  new SemanticFilter(
    {
      async chat(messages) {
        const user = messages.at(-1)?.content ?? ''
        if (user.includes('好物推荐') || user.includes('点击查看详情')) {
          return '{"relevant":false}'
        }
        return '{"relevant":true}'
      },
    },
    true,
  ),
  new DedupeFilter(cfg.notifications.dedupeWindowMs),
])
const svc = new NotificationService(
  [http],
  pipeline,
  100,
  http,
  resolve('data/notifications/cancel.log'),
)
await svc.start()
console.log('LIVE_SEMANTIC_READY connected=', http.connected)
await new Promise(resolve => setTimeout(resolve, 600000))
await svc.stop()
console.log('LIVE_DONE stats=', JSON.stringify(svc.stats()))
