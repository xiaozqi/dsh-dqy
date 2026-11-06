// End-to-end verification of the mirror panel subsystem: real NodeShell,
// FileMirrorConfigStore, ScrcpyMirror and MirrorPanelService wired to a real
// device, but served through an in-memory HTTP host so the security gates and
// every route can be exercised without the DSH runtime.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MIRROR_DEFAULTS } from '../lib/domain/mirror-defaults.js'
import { resolveAdbPath } from '../lib/infrastructure/adb/resolve-adb.js'
import { resolveScrcpyPath } from '../lib/infrastructure/mirror/resolve-scrcpy.js'
import { ScrcpyMirror } from '../lib/infrastructure/mirror/scrcpy-mirror.js'
import { FileMirrorConfigStore } from '../lib/infrastructure/mirror/file-mirror-config.js'
import { NodeShell } from '../lib/infrastructure/node-shell.js'
import { createFileLogger } from '../lib/infrastructure/file-logger.js'
import { MirrorHttpController } from '../lib/infrastructure/web/mirror-http.controller.js'
import { MirrorPanelService } from '../lib/application/mirror/mirror-panel.service.js'

const BASE = '/fishline-mirror'
// Set the target device explicitly: FIM_TEST_SERIAL=xxxx node tests/verify-mirror.mjs
const SERIAL = process.env.FIM_TEST_SERIAL ?? ''

// In-memory WebServerPort backed by a real node http server.
class FakeWebServer {
  constructor() {
    this.routes = new Map()
    this.tappers = []
    this.injectListeners = []
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const handler = this.routes.get(url.pathname)
      if (!handler) {
        res.writeHead(404)
        res.end()
        return
      }
      handler(req, res)
    })
  }

  register(route) {
    this.routes.set(route.path, route.handler)
    return () => this.routes.delete(route.path)
  }

  tapIndex(fn) {
    this.tappers.push(fn)
    return () => {}
  }

  onIndexInject(fn) {
    this.injectListeners.push(fn)
    return () => {}
  }

  start() {
    return new Promise(res => this.server.listen(0, res))
  }

  get port() {
    return this.server.address().port
  }

  stop() {
    return new Promise(res => this.server.close(res))
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  if (!SERIAL) {
    console.error('Set FIM_TEST_SERIAL to an online device, e.g. FIM_TEST_SERIAL=192.168.1.1:5555')
    process.exit(2)
  }
  const work = await mkdtemp(join(tmpdir(), 'fim-verify-'))
  const projectRoot = fileURLToPath(new URL('../', import.meta.url))
  const fake = new FakeWebServer()
  let panel
  try {
    const configStore = new FileMirrorConfigStore(
      join(work, 'mirror-config.json'),
      { ...MIRROR_DEFAULTS, serial: SERIAL },
    )
    const shell = new NodeShell()
    const logger = createFileLogger(join(work, 'mirror.log'))
    const mirror = new ScrcpyMirror({
      resolveAdb: resolveAdbPath,
      resolveScrcpy: resolveScrcpyPath,
      onExit: (code, byUser) => panel.handleExit(code, byUser),
    })
    panel = new MirrorPanelService({
      configStore,
      mirror,
      shell,
      resolveAdb: resolveAdbPath,
      resolveScrcpy: resolveScrcpyPath,
      pluginVersion: '0.1.0',
      logPath: join(work, 'mirror.log'),
      panelAssetPath: join(projectRoot, 'resources', 'mirror', 'panel.js'),
      logger,
    })
    const controller = new MirrorHttpController(fake, panel, BASE)
    const stopHttp = controller.register()
    await fake.start()
    const root = `http://localhost:${fake.port}`
    const sameOrigin = root

    // 1. Route registration covers the full 18-route contract.
    assert.equal(fake.routes.size, 18, `expected 18 routes, got ${fake.routes.size}`)
    console.log('ok 1 - 18 routes registered')

    // 2. Injection hooks are wired.
    const table = []
    fake.injectListeners.forEach(l => l(table))
    assert.equal(table.length, 1)
    assert.equal(table[0].kind, 'script-src')
    assert.equal(table[0].src, `${BASE}/panel.js`)
    console.log('ok 2 - index injection table entry')

    // 3. Read routes reject non-GET methods.
    let res = await fetch(`${root}${BASE}/status`, { method: 'POST' })
    assert.equal(res.status, 405)
    console.log('ok 3 - read route rejects POST with 405')

    // 4. Write route rejects POST without token.
    res = await fetch(`${root}${BASE}/stop`, { method: 'POST' })
    assert.equal(res.status, 403)
    console.log('ok 4 - write route without token is 403')

    // 5. Write route rejects cross-origin POST even with a token header.
    const token = panel.getStatus().token
    res = await fetch(`${root}${BASE}/stop`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'x-fim-token': 'whatever' },
    })
    assert.equal(res.status, 403)
    console.log('ok 5 - cross-origin POST is 403')

    // 6. panel.js is served with the real token injected.
    res = await fetch(`${root}${BASE}/panel.js`)
    assert.equal(res.status, 200)
    const script = await res.text()
    assert.ok(script.includes('__FIM_TOKEN__') === false, 'placeholder must be replaced')
    const tokenMatch = script.match(/var TOKEN = '([0-9a-f]+)'/)
    assert.ok(tokenMatch, 'token literal present')
    const realToken = tokenMatch[1]
    console.log('ok 6 - panel.js served with injected token')

    const post = (sub, body) =>
      fetch(`${root}${BASE}${sub}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: sameOrigin,
          'x-fim-token': realToken,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    // 7. Real device discovery through the service.
    res = await fetch(`${root}${BASE}/devices`, { headers: { Origin: sameOrigin } })
    const devices = await res.json()
    assert.equal(devices.ok, true)
    assert.ok(devices.devices.some(d => d.serial === SERIAL), 'real device listed')
    console.log('ok 7 - real device discovered')

    // 8. Dependency check reports adb and scrcpy available.
    res = await fetch(`${root}${BASE}/deps`, { headers: { Origin: sameOrigin } })
    const deps = await res.json()
    assert.equal(deps.adb.found, true)
    assert.equal(deps.scrcpy.found, true)
    console.log('ok 8 - adb/scrcpy dependencies available')

    // 9. Start the real scrcpy window.
    res = await post('/start')
    const started = await res.json()
    assert.equal(started.ok, true, JSON.stringify(started))
    await sleep(3500)
    const running = panel.getStatus()
    assert.equal(running.state, 'running', `expected running, got ${running.state}`)
    console.log('ok 9 - scrcpy window started and running')

    // 10. Phone state reflects the real device.
    res = await fetch(`${root}${BASE}/phone`, { headers: { Origin: sameOrigin } })
    const phone = await res.json()
    assert.equal(phone.ok, true)
    assert.equal(typeof phone.supported, 'boolean')
    console.log('ok 10 - phone state reported')

    // 11. Key press reaches the device (back is non-destructive).
    res = await post('/key', { code: 4 })
    const key = await res.json()
    assert.equal(key.ok, true)
    console.log('ok 11 - back key press delivered')

    // 12. Stop the window and confirm the session returns to idle.
    res = await post('/stop')
    const stopped = await res.json()
    assert.equal(stopped.ok, true)
    await sleep(1500)
    assert.equal(panel.getStatus().state, 'idle')
    console.log('ok 12 - scrcpy window stopped cleanly')

    stopHttp()
    console.log('\nAll 12 verification checks passed.')
  } finally {
    await panel?.stop().catch(() => {})
    await fake.stop().catch(() => {})
    await rm(work, { recursive: true, force: true })
  }
}

main().catch(e => {
  console.error('VERIFICATION FAILED:', e)
  process.exit(1)
})
