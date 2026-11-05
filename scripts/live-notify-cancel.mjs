// Standalone long-running instance of the notification cancel loop with the
// same wiring as the main program (src/index.ts): rules come from the Config
// schema defaults when no user config is supplied. Run it when the main
// program is not started; otherwise the main program already serves :14123.
import { resolve } from 'node:path'

import { NotificationPipeline } from '../lib/application/notifications/pipeline.js'
import { NotificationService } from '../lib/application/notifications/notification.service.js'
import {
  AppBlocklistFilter,
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
  new AppBlocklistFilter(new Set(cfg.notifications.blockedApps)),
  new RuleFilter(
    cfg.notifications.rules.map(r => ({
      match: new RegExp(r.pattern, r.caseSensitive ? '' : 'i'),
      action: r.action,
    })),
  ),
  new SemanticFilter(null, cfg.notifications.semanticEnabled),
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
console.log('LIVE_READY connected=', http.connected, 'rules=', cfg.notifications.rules.length)
// keep serving; duration in ms via LIVE_DURATION_MS (default 600s, 0 = forever)
const duration = Number(process.env.LIVE_DURATION_MS ?? 600000)
if (duration > 0) {
  await new Promise(resolve => setTimeout(resolve, duration))
  await svc.stop()
}
console.log('LIVE_DONE stats=', JSON.stringify(svc.stats()))
