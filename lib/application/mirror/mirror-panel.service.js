import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIRROR_DEFAULTS } from '../../domain/mirror-defaults.js';
import { parseAdbVersion, parseDevices, parseScrcpyVersion, pickDevice, } from './device-parser.js';
import { isAwake, isLocked, isSecure, keyguardSignals, parseUnlockOutput, unlockScript, } from './keyguard.js';
const RECONNECT_DELAYS = [1500, 3000, 8000, 10000, 10000, 10000];
const PHONE_DUMP = "dumpsys window 2>/dev/null | grep -E 'isStatusBarKeyguard|mDreamingLockscreen|mShowingLockscreen|mKeyguardShowing|showing=' ; " +
    "dumpsys window policy 2>/dev/null | grep -E 'mKeyguardShowing|isStatusBarKeyguard' ; " +
    "dumpsys power 2>/dev/null | grep mWakefulness=";
// Application service orchestrating every panel use case. It depends only on
// domain ports and pure mirror rules; all process and storage details are
// injected, and this class never reaches for a concrete host service.
export class MirrorPanelService {
    deps;
    cmdCache = {
        key: '\u0000',
        adb: '',
        scrcpy: '',
        at: 0,
    };
    verCache = { at: 0, adb: '', scrcpy: '' };
    phoneCache = { at: 0, serial: '', value: null };
    activeSerial = '';
    activeAt = 0;
    lastPick = { serial: '', source: '', online: [] };
    deviceModel = '';
    modelProbing = false;
    lastAdbOkAt = 0;
    retryTimer = null;
    retries = 0;
    installingDep = '';
    constructor(deps) {
        this.deps = deps;
    }
    // ---- process exit / reconnect ----
    // Wired to the mirror's onExit callback by the composition root.
    handleExit(code, byUser) {
        if (byUser) {
            this.retries = 0;
            this.clearRetry();
            return;
        }
        if (code !== 0)
            this.scheduleReconnect();
    }
    scheduleReconnect() {
        const config = this.deps.configStore.load();
        if (!config.reconnect || this.retryTimer)
            return;
        if (this.retries >= RECONNECT_DELAYS.length)
            return;
        const delay = RECONNECT_DELAYS[this.retries];
        this.retries++;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.deps.mirror.status().state !== 'error')
                return;
            this.start().catch(() => { });
        }, delay);
    }
    clearRetry() {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }
    // ---- command / serial / model / versions ----
    // Resolve adb and scrcpy with a 30s cache to avoid blocking the host on
    // every status poll.
    resolveCommands(config) {
        const key = `${config.adb}\u0000${config.scrcpy}`;
        if (this.cmdCache.key === key &&
            Date.now() - this.cmdCache.at < 30000) {
            return this.cmdCache;
        }
        this.cmdCache = {
            key,
            adb: this.deps.resolveAdb(config.adb),
            scrcpy: this.deps.resolveScrcpy(config.scrcpy),
            at: Date.now(),
        };
        return this.cmdCache;
    }
    // Resolve the active serial with a 15s cache; -l output also carries the
    // model and the online list used for explicit picking.
    async resolveSerial(config, force = false) {
        if (!config.serial)
            return '';
        if (!force && this.activeSerial && Date.now() - this.activeAt < 15000) {
            return this.activeSerial;
        }
        const cmds = this.resolveCommands(config);
        const r = await this.deps.shell.run(cmds.adb, ['devices', '-l'], 4000);
        const pick = pickDevice(parseDevices(r.stdout), config.serial);
        this.lastPick = pick;
        this.activeSerial = pick.serial;
        this.activeAt = Date.now();
        return pick.serial;
    }
    // Probe the model once; the value is cached so it does not flicker when a
    // network phone gets a new DHCP address.
    ensureModel(config, serial) {
        if (this.modelProbing || !serial || this.deviceModel)
            return;
        this.modelProbing = true;
        const cmds = this.resolveCommands(config);
        this.deps.shell
            .run(cmds.adb, ['-s', serial, 'shell', 'getprop', 'ro.product.model'], 4000)
            .then(r => {
            const model = r.stdout.trim();
            if (model)
                this.deviceModel = model;
        })
            .catch(() => { })
            .finally(() => {
            this.modelProbing = false;
        });
    }
    // adb/scrcpy versions with a 60s cache; missing commands yield empty strings.
    async versions(config, force = false) {
        if (!force && this.verCache.at && Date.now() - this.verCache.at < 60000) {
            return this.verCache;
        }
        const cmds = this.resolveCommands(config);
        const [a, s] = await Promise.all([
            this.deps.shell
                .run(cmds.adb, ['version'], 4000)
                .catch(() => ({ code: -1, stdout: '', stderr: '' })),
            this.deps.shell
                .run(cmds.scrcpy, ['--version'], 4000)
                .catch(() => ({ code: -1, stdout: '', stderr: '' })),
        ]);
        this.verCache = {
            at: Date.now(),
            adb: parseAdbVersion(a.stdout + a.stderr),
            scrcpy: parseScrcpyVersion(s.stdout + s.stderr),
        };
        return this.verCache;
    }
    // ---- status / phone ----
    // Full status snapshot consumed by the panel.
    getStatus() {
        const config = this.deps.configStore.load();
        if (this.deviceModel && config.serial !== this.activeSerial && !this.activeSerial) {
            this.deviceModel = '';
        }
        this.ensureModel(config, this.activeSerial || config.serial);
        const process = this.deps.mirror.status();
        return {
            ok: true,
            ...process,
            serial: config.serial,
            device: this.deviceModel,
            wireless: String(config.serial).includes(':'),
            version: this.deps.pluginVersion,
            adb: this.resolveCommands(config).adb,
            scrcpy: this.resolveCommands(config).scrcpy,
            autoStart: config.autoStart,
            alwaysOnTop: config.alwaysOnTop,
            audio: config.audio,
            turnScreenOff: config.turnScreenOff,
            windowWidth: config.windowWidth,
        };
    }
    // Keyguard/screen state with a 2s cache bound to the serial.
    async getPhoneState() {
        const config = this.deps.configStore.load();
        if (!config.serial) {
            return {
                ok: false,
                locked: null,
                awake: null,
                secure: null,
                supported: false,
                error: '还没配置手机',
            };
        }
        const cmds = this.resolveCommands(config);
        const serial = await this.resolveSerial(config);
        if (!serial) {
            return {
                ok: false,
                locked: null,
                awake: null,
                secure: null,
                supported: false,
                error: '手机不在线',
            };
        }
        if (this.phoneCache.value &&
            this.phoneCache.serial === serial &&
            Date.now() - this.phoneCache.at < 2000) {
            return this.phoneCache.value;
        }
        const r = await this.deps.shell.run(cmds.adb, ['-s', serial, 'shell', PHONE_DUMP], 5000);
        const out = r.stdout || '';
        if (r.code !== 0 && !out) {
            return {
                ok: false,
                locked: null,
                awake: null,
                secure: null,
                supported: false,
                error: r.stderr.trim() || 'adb 执行失败',
            };
        }
        this.lastAdbOkAt = Date.now();
        const locked = isLocked(out);
        const value = {
            ok: true,
            locked,
            awake: isAwake(out),
            secure: isSecure(out),
            supported: keyguardSignals(out) > 0 || locked !== null,
        };
        this.phoneCache = { at: Date.now(), serial, value };
        return value;
    }
    // ---- config ----
    // Mask the PIN before sending config to the page.
    publicConfig(config) {
        return { ...config, pin: config.pin ? '••••••' : '' };
    }
    getConfig() {
        const config = this.deps.configStore.load();
        return {
            ok: true,
            config: this.publicConfig(config),
            defaults: MIRROR_DEFAULTS,
        };
    }
    updateConfig(patch) {
        const current = this.deps.configStore.load();
        const merged = { ...current, ...patch };
        const saved = this.deps.configStore.save(merged);
        if (!saved)
            return { ok: false, error: '保存失败' };
        this.invalidateCaches();
        return { ok: true, config: this.publicConfig(this.deps.configStore.load()) };
    }
    invalidateCaches() {
        this.cmdCache = { key: '\u0000', adb: '', scrcpy: '', at: 0 };
        this.verCache = { at: 0, adb: '', scrcpy: '' };
        this.activeSerial = '';
        this.activeAt = 0;
    }
    // ---- devices ----
    async listDevices() {
        const config = this.deps.configStore.load();
        const cmds = this.resolveCommands(config);
        const r = await this.deps.shell.run(cmds.adb, ['devices', '-l'], 8000);
        return {
            ok: true,
            devices: parseDevices(r.stdout),
            adb: cmds.adb,
        };
    }
    // ---- deps ----
    // winget is an app-execution alias reparse point that existsSync cannot see,
    // so presence is checked by listing WindowsApps.
    hasWinget() {
        const local = process.env.LOCALAPPDATA;
        if (!local)
            return false;
        const dir = join(local, 'Microsoft', 'WindowsApps');
        try {
            return readdirSync(dir).some(f => f.toLowerCase() === 'winget.exe');
        }
        catch {
            return false;
        }
    }
    async getDeps() {
        const config = this.deps.configStore.load();
        const cmds = this.resolveCommands(config);
        const v = await this.versions(config);
        return {
            ok: true,
            adb: {
                found: existsSync(cmds.adb) || Boolean(v.adb),
                path: cmds.adb,
                version: v.adb,
            },
            scrcpy: {
                found: existsSync(cmds.scrcpy) || Boolean(v.scrcpy),
                path: cmds.scrcpy,
                version: v.scrcpy,
            },
            winget: this.hasWinget(),
            installing: this.installingDep,
            plugin: this.deps.pluginVersion,
        };
    }
    async installDep(what) {
        const wingetIds = {
            adb: 'Google.PlatformTools',
            scrcpy: 'Genymobile.scrcpy',
        };
        const id = wingetIds[what];
        if (!id)
            return { ok: false, error: 'what 只能是 adb 或 scrcpy' };
        if (this.installingDep) {
            return { ok: false, error: `正在装 ${this.installingDep}，稍等一下` };
        }
        if (!this.hasWinget()) {
            return { ok: false, error: '这台机器没有 winget，只能手动安装' };
        }
        this.installingDep = what;
        const r = await this.deps.shell.run('winget', [
            'install',
            '--id',
            id,
            '--exact',
            '--silent',
            '--source',
            'winget',
            '--accept-package-agreements',
            '--accept-source-agreements',
            '--disable-interactivity',
        ], 600000);
        this.installingDep = '';
        this.invalidateCaches();
        const config = this.deps.configStore.load();
        const cmds = this.resolveCommands(config);
        const found = existsSync(what === 'adb' ? cmds.adb : cmds.scrcpy);
        return {
            ok: found,
            found,
            output: (r.stdout + r.stderr).slice(-1500),
        };
    }
    // ---- start / stop ----
    async start() {
        const config = this.deps.configStore.load();
        const state = this.deps.mirror.status().state;
        if (state === 'running' || state === 'starting' || state === 'stopping') {
            return { ok: true, already: true };
        }
        if (!config.serial) {
            return { ok: false, error: '还没配置手机：先在面板里点「查找手机」' };
        }
        const cmds = this.resolveCommands(config);
        let serial = await this.resolveSerial(config);
        if (!serial && config.serial.includes(':')) {
            await this.deps.shell.run(cmds.adb, ['connect', config.serial], 3000);
            this.activeAt = 0;
            serial = await this.resolveSerial(config, true);
        }
        if (!serial) {
            const online = this.lastPick.online || [];
            return {
                ok: false,
                needPick: online.length > 0,
                devices: online.map(d => ({ serial: d.serial, model: d.model })),
                error: online.length > 0
                    ? `在线有 ${online.length} 台手机，配置的 ${config.serial} 不在其中：选一台再投屏`
                    : `手机不在线（${config.serial}）：先 adb connect 或插 USB`,
            };
        }
        if (serial !== config.serial) {
            config.serial = serial;
            this.deps.configStore.save(config);
        }
        const result = await this.deps.mirror.launch(config, serial);
        if (result.ok) {
            this.retries = 0;
            this.ensureModel(config, serial);
        }
        return result;
    }
    async stop() {
        this.clearRetry();
        return this.deps.mirror.stop();
    }
    // ---- key ----
    async pressKey(code) {
        const config = this.deps.configStore.load();
        const serial = await this.resolveSerial(config);
        if (!serial)
            return { ok: false, error: '手机不在线' };
        const cmds = this.resolveCommands(config);
        const r = await this.deps.shell.run(cmds.adb, ['-s', serial, 'shell', 'input', 'keyevent', String(code)], 8000);
        return r.code === 0
            ? { ok: true }
            : { ok: false, error: r.stderr.trim() || 'adb 执行失败' };
    }
    // ---- topmost ----
    waitIdle(timeoutMs = 6000) {
        return new Promise(resolve => {
            const t0 = Date.now();
            const tick = () => {
                const state = this.deps.mirror.status().state;
                if (state === 'idle' || state === 'error')
                    return resolve(true);
                if (Date.now() - t0 > timeoutMs)
                    return resolve(false);
                setTimeout(tick, 100);
            };
            tick();
        });
    }
    async setTopmost(on) {
        const config = this.deps.configStore.load();
        const changed = config.alwaysOnTop !== on;
        config.alwaysOnTop = on;
        this.deps.configStore.save(config);
        const state = this.deps.mirror.status().state;
        const running = state === 'running' || state === 'starting';
        if (!running || !changed) {
            return { ok: true, alwaysOnTop: on, restarted: false };
        }
        await this.deps.mirror.stop();
        const stopped = await this.waitIdle();
        if (!stopped) {
            return { ok: false, error: '窗口没能正常停止，置顶没切过去' };
        }
        const r = await this.start();
        return { ...r, alwaysOnTop: on, restarted: true };
    }
    // ---- unlock / lock ----
    async unlock() {
        const config = this.deps.configStore.load();
        if (!config.serial) {
            return { ok: false, steps: [], error: '还没配置手机' };
        }
        const cmds = this.resolveCommands(config);
        const serial = await this.resolveSerial(config);
        if (!serial) {
            return { ok: false, steps: [], error: '手机不在线：先 adb connect 或插 USB' };
        }
        if (serial.includes(':') && Date.now() - this.lastAdbOkAt > 15000) {
            await this.deps.shell.run(cmds.adb, ['connect', serial], 6000);
        }
        if (!config.pin) {
            const st = await this.getPhoneState();
            if (st.secure === true) {
                return {
                    ok: false,
                    steps: [],
                    needPin: true,
                    error: '手机设了锁屏密码，需要你提供 PIN 才能解锁',
                };
            }
            if (st.ok && st.supported === false) {
                return {
                    ok: false,
                    steps: [],
                    unsupported: true,
                    error: '读不到这台手机的锁屏状态，解锁已跳过',
                };
            }
        }
        const r = await this.deps.shell.run(cmds.adb, ['-s', serial, 'shell', unlockScript(config.pin)], 25000);
        if (r.code === -1) {
            return {
                ok: false,
                steps: [],
                error: 'adb 执行失败：' + r.stderr.trim(),
            };
        }
        const parsed = parseUnlockOutput(r.stdout);
        const locked = isLocked(parsed.finalDump);
        const awake = isAwake(parsed.finalDump);
        this.phoneCache = { at: 0, serial: '', value: null };
        this.lastAdbOkAt = Date.now();
        if (locked === null) {
            return {
                ok: false,
                steps: parsed.steps,
                locked: null,
                awake,
                unsupported: true,
                error: '读不到锁屏状态，解锁已跳过',
            };
        }
        if (parsed.already) {
            return {
                ok: locked === false && awake !== false,
                steps: parsed.steps,
                locked,
                awake,
                already: true,
            };
        }
        const outcome = {
            ok: locked === false && awake !== false,
            steps: parsed.steps,
            locked,
            awake,
        };
        if (!outcome.ok) {
            outcome.error =
                locked === true
                    ? '解锁失败：还停在锁屏（PIN 可能不对）'
                    : '手机没醒';
        }
        return outcome;
    }
    async lock() {
        const config = this.deps.configStore.load();
        if (!config.serial)
            return { ok: false, error: '还没配置手机' };
        const cmds = this.resolveCommands(config);
        const serial = await this.resolveSerial(config);
        if (!serial)
            return { ok: false, error: '手机不在线：先 adb connect 或插 USB' };
        if (serial.includes(':') && Date.now() - this.lastAdbOkAt > 15000) {
            await this.deps.shell.run(cmds.adb, ['connect', serial], 3000);
        }
        const r = await this.deps.shell.run(cmds.adb, ['-s', serial, 'shell', 'input', 'keyevent', '223'], 8000);
        if (r.code !== 0) {
            return { ok: false, error: r.stderr.trim() || 'adb 执行失败' };
        }
        await new Promise(resolve => setTimeout(resolve, 400));
        this.phoneCache = { at: 0, serial: '', value: null };
        this.lastAdbOkAt = Date.now();
        const state = await this.getPhoneState();
        return { ok: true, locked: state.locked, awake: state.awake };
    }
    // ---- wireless / disconnect / reset ----
    // Switch the current USB device to wireless: tcpip -> read IP -> connect ->
    // persist the new serial. An optional explicit IP overrides discovery.
    async switchWireless(body) {
        const config = this.deps.configStore.load();
        const cmds = this.resolveCommands(config);
        const devices = await this.deps.shell.run(cmds.adb, ['devices', '-l'], 5000);
        const online = parseDevices(devices.stdout).filter(d => d.state === 'device');
        const usbs = online.filter(d => !String(d.serial).includes(':'));
        const usb = usbs.find(d => d.serial === config.serial) ??
            (usbs.length === 1 ? usbs[0] : null);
        if (!usb) {
            if (usbs.length > 1) {
                return {
                    ok: false,
                    needPick: true,
                    error: `插着 ${usbs.length} 台 USB 设备，先选一台再切无线`,
                };
            }
            return {
                ok: false,
                error: '没找到 USB 连着的手机：无线切换需要先用数据线连一次',
            };
        }
        const target = usb.serial;
        const wasRunning = this.deps.mirror.status().state === 'running' ||
            this.deps.mirror.status().state === 'starting';
        if (wasRunning)
            await this.deps.mirror.stop();
        const t = await this.deps.shell.run(cmds.adb, ['-s', target, 'tcpip', '5555'], 6000);
        if (t.code !== 0) {
            return {
                ok: false,
                error: 'adb tcpip 5555 失败：' + (t.stderr || t.stdout).trim(),
            };
        }
        await new Promise(r => setTimeout(r, 1200));
        let ip = String(body.ip || '').trim();
        if (!ip) {
            const r = await this.deps.shell.run(cmds.adb, ['-s', target, 'shell', 'ip', '-4', 'addr', 'show', 'wlan0'], 4000);
            const m = /inet\s+(\d+\.\d+\.\d+\.\d+)/.exec(r.stdout);
            ip = m ? m[1] : '';
        }
        if (!ip) {
            const r = await this.deps.shell.run(cmds.adb, ['-s', target, 'shell', 'ip', 'route'], 4000);
            const m = /src\s+(\d+\.\d+\.\d+\.\d+)/.exec(r.stdout);
            ip = m ? m[1] : '';
        }
        if (!ip) {
            return {
                ok: false,
                needIp: true,
                error: '读不到手机 IP（可能没连 WiFi），可以手动填 IP 再试',
            };
        }
        const host = `${ip}:5555`;
        const c = await this.deps.shell.run(cmds.adb, ['connect', host], 8000);
        const after = await this.deps.shell.run(cmds.adb, ['devices'], 4000);
        const ready = parseDevices(after.stdout).some(d => d.serial === host && d.state === 'device');
        if (!ready) {
            return {
                ok: false,
                needIp: true,
                error: 'adb connect 没成功：' + (c.stdout || c.stderr).trim(),
            };
        }
        config.serial = host;
        this.deps.configStore.save(config);
        this.deviceModel = '';
        this.activeSerial = '';
        this.activeAt = 0;
        let restarted = false;
        if (wasRunning) {
            const r = await this.start().catch(() => ({ ok: false }));
            restarted = r.ok;
        }
        return { ok: true, serial: host, ip, restarted };
    }
    async disconnect() {
        const config = this.deps.configStore.load();
        const serial = String(config.serial || '');
        if (serial.includes(':')) {
            const cmds = this.resolveCommands(config);
            await this.deps.shell.run(cmds.adb, ['disconnect', serial], 5000);
            this.activeSerial = '';
            this.activeAt = 0;
        }
        this.clearRetry();
        await this.deps.mirror.stop();
        return { ok: true };
    }
    resetSettings() {
        const current = this.deps.configStore.load();
        const reset = { ...MIRROR_DEFAULTS, serial: current.serial };
        this.deps.configStore.save(reset);
        this.deviceModel = '';
        this.invalidateCaches();
        return { ok: true, config: this.publicConfig(reset) };
    }
    // ---- diagnostics / log ----
    async getDiagnostics() {
        const config = this.deps.configStore.load();
        const v = await this.versions(config, true);
        const st = this.getStatus();
        const ps = await this.getPhoneState().catch(() => null);
        const serial = await this.resolveSerial(config).catch(() => '');
        let keyguard = '';
        if (serial) {
            const cmds = this.resolveCommands(config);
            const r = await this.deps.shell.run(cmds.adb, [
                '-s',
                serial,
                'shell',
                "dumpsys window 2>/dev/null | grep -E 'isStatusBarKeyguard|mDreamingLockscreen|mShowingLockscreen|mKeyguardShowing|^ *secure='; " +
                    "dumpsys power 2>/dev/null | grep mWakefulness=",
            ], 5000);
            keyguard = r.stdout.trim();
        }
        let logTail = '';
        try {
            logTail = readFileSync(this.deps.logPath, 'utf8')
                .trim()
                .split(/\r?\n/)
                .slice(-40)
                .join('\n');
        }
        catch {
            /* no log yet */
        }
        const lines = [
            '## fishline mirror diagnostics',
            `插件版本: ${this.deps.pluginVersion}`,
            `系统: ${process.platform} ${process.arch} / Node ${process.version}`,
            `设备: ${st.device || '?'} (${st.serial || '未配置'})`,
            `连接: ${st.wireless ? '无线' : 'USB'} / 状态: ${st.state}${st.error ? ` / ${st.error}` : ''}`,
            `adb: ${st.adb || '?'}${v.adb ? ` (v${v.adb})` : ' (版本未知)'}`,
            `scrcpy: ${st.scrcpy || '?'}${v.scrcpy ? ` (v${v.scrcpy})` : ' (版本未知)'}`,
            `PIN: ${config.pin ? '已设置' : '未设置'}`,
            `锁屏判据: ${ps && ps.ok ? `locked=${ps.locked} awake=${ps.awake} supported=${ps.supported}` : '读不到'}`,
            `配置: ${JSON.stringify(this.publicConfig(config))}`,
            '',
            '### dumpsys keyguard',
            keyguard || '(空)',
            '',
            '### 日志（最后 40 行）',
            logTail || '(空)',
            '',
        ];
        return { ok: true, text: lines.join('\n') };
    }
    getLog() {
        try {
            return readFileSync(this.deps.logPath, 'utf8')
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-120)
                .join('\n');
        }
        catch {
            return '';
        }
    }
    // ---- panel asset ----
    // Read the panel script and inject the per-start token.
    readPanelScript(token) {
        let body;
        try {
            body = readFileSync(this.deps.panelAssetPath, 'utf8');
        }
        catch {
            return 'console.warn("panel asset missing")';
        }
        return body.replace('__FIM_TOKEN__', token);
    }
}
