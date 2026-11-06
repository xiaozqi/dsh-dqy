import { spawn } from 'node:child_process';
const ENQUEUE_RE = /enqueueNotificationInternal:\s*pkg=(\S+)\s+id=(\d+)\s+notification=/;
const CHANNEL_INFO_RE = /enqueueNotificationInternal Channel Info :\s*pkg=(\S+)\s+id=(\d+)\s+importance\s*=\s*(\d+)/;
const POSTED_RE = /onNotificationPosted:\s*StatusBarNotification\(pkg=(\S+)\s+user=\S+\s+id=(\d+)\s+tag=(\S+)/;
const IMPORTANCE_RE = /important=(\d+)/;
const WHEN_RE = /when=(\d{13})/;
const FLUSH_DELAY_MS = 1200;
const POSTED_GRACE_MS = 2500;
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 1000;
export class LogcatNotificationSource {
    adbPath;
    serial;
    defaultImportance;
    child = null;
    listeners = new Set();
    connectedFlag = false;
    startedFlag = false;
    seq = 0;
    restartAttempts = 0;
    stdoutBuffer = '';
    pending = new Map();
    postedAt = new Map();
    constructor(adbPath, serial, defaultImportance = 2) {
        this.adbPath = adbPath;
        this.serial = serial;
        this.defaultImportance = defaultImportance;
    }
    get connected() {
        return this.connectedFlag;
    }
    async start() {
        if (this.startedFlag) {
            return;
        }
        this.startedFlag = true;
        this.spawnChild();
    }
    async stop() {
        this.startedFlag = false;
        this.connectedFlag = false;
        this.restartAttempts = 0;
        if (this.child) {
            this.child.kill();
            this.child = null;
        }
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
        }
        this.pending.clear();
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    spawnChild() {
        const args = this.serial
            ? ['-s', this.serial, 'logcat', '-v', 'time']
            : ['logcat', '-v', 'time'];
        // stderr must never be an unread pipe: adb errors ("device offline",
        // repeated daemon messages) would fill it, block the child forever, while
        // `connected` still reported true.
        const child = spawn(this.adbPath, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        this.child = child;
        this.connectedFlag = true;
        this.stdoutBuffer = '';
        child.stdout.on('data', chunk => {
            this.stdoutBuffer += Buffer.from(chunk).toString('utf8');
            let newline = this.stdoutBuffer.indexOf('\n');
            while (newline !== -1) {
                const line = this.stdoutBuffer.slice(0, newline);
                this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
                this.handleLine(line);
                newline = this.stdoutBuffer.indexOf('\n');
            }
        });
        child.on('error', () => {
            this.connectedFlag = false;
            child.kill();
        });
        child.on('close', () => {
            // A restart can replace the handle before the old child closes; never
            // null the *new* handle — doing so orphaned a live logcat that could no
            // longer be killed for the rest of the process lifetime.
            if (this.child !== child) {
                return;
            }
            this.child = null;
            this.connectedFlag = false;
            if (this.startedFlag) {
                this.scheduleRestart();
            }
        });
    }
    scheduleRestart() {
        if (this.restartAttempts >= MAX_RESTARTS) {
            return;
        }
        this.restartAttempts += 1;
        setTimeout(() => {
            if (this.startedFlag && !this.child) {
                this.spawnChild();
            }
        }, RESTART_DELAY_MS).unref();
    }
    handleLine(raw) {
        const posted = matchPosted(raw);
        if (posted) {
            this.handlePosted(posted);
            return;
        }
        const channel = matchChannelInfo(raw);
        if (channel) {
            this.handleChannelInfo(channel);
            return;
        }
        const enqueue = matchEnqueue(raw);
        if (enqueue) {
            this.handleEnqueue(enqueue);
        }
    }
    handleEnqueue(anchor) {
        const key = `${anchor.pkg}:${anchor.id}`;
        const existing = this.pending.get(key);
        if (existing) {
            clearTimeout(existing.timer);
            existing.timer = setTimeout(() => this.flush(key), FLUSH_DELAY_MS);
            return;
        }
        const timer = setTimeout(() => this.flush(key), FLUSH_DELAY_MS);
        this.pending.set(key, {
            pkg: anchor.pkg,
            importance: this.defaultImportance,
            text: '',
            when: Date.now(),
            timer,
        });
    }
    flush(key) {
        const pending = this.pending.get(key);
        if (!pending) {
            return;
        }
        this.pending.delete(key);
        this.postedAt.set(key, Date.now());
        this.emit(pending.pkg, pending.importance, pending.text, pending.when);
    }
    handleChannelInfo(info) {
        const pending = this.pending.get(`${info.pkg}:${info.id}`);
        if (pending) {
            pending.importance = info.importance;
        }
    }
    handlePosted(posted) {
        const key = `${posted.pkg}:${posted.id}`;
        const now = Date.now();
        const pending = this.pending.get(key);
        if (pending) {
            if (posted.text && posted.text !== 'null') {
                pending.text = posted.text;
            }
            if (posted.importance !== null) {
                pending.importance = posted.importance;
            }
            if (posted.when !== null) {
                pending.when = posted.when;
            }
            return;
        }
        const flushedAt = this.postedAt.get(key) ?? 0;
        if (now - flushedAt < POSTED_GRACE_MS) {
            return;
        }
        this.postedAt.set(key, now);
        this.emit(posted.pkg, posted.importance ?? this.defaultImportance, posted.text === 'null' ? '' : posted.text, posted.when ?? now);
    }
    emit(app, importance, text, when) {
        const event = {
            id: `${Date.now()}-${this.seq++}`,
            app,
            title: '',
            text,
            when,
            importance,
            source: 'logcat',
        };
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch {
                /* a listener failure must not break the source stream */
            }
        }
    }
}
function matchEnqueue(line) {
    const m = ENQUEUE_RE.exec(line);
    if (!m) {
        return null;
    }
    return { pkg: m[1], id: m[2] };
}
function matchChannelInfo(line) {
    const m = CHANNEL_INFO_RE.exec(line);
    if (!m) {
        return null;
    }
    return { pkg: m[1], id: m[2], importance: Number(m[3]) };
}
function matchPosted(line) {
    const m = POSTED_RE.exec(line);
    if (!m) {
        return null;
    }
    const importance = IMPORTANCE_RE.exec(line);
    const when = WHEN_RE.exec(line);
    return {
        pkg: m[1],
        id: m[2],
        text: m[3],
        importance: importance ? Number(importance[1]) : null,
        when: when ? Number(when[1]) : null,
    };
}
