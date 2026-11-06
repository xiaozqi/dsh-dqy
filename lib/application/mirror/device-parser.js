import { MIRROR_WINDOW_TITLE as WINDOW_TITLE } from '../../domain/mirror-defaults.js';
export { WINDOW_TITLE };
// Parse `adb devices -l` output into device rows.
export function parseDevices(text) {
    const out = [];
    for (const line of String(text || '')
        .split(/\r?\n/)
        .slice(1)) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const m = /^(\S+)\s+(\S+)(?:\s+.*?\bmodel:(\S+))?/.exec(trimmed);
        if (!m)
            continue;
        out.push({ serial: m[1], state: m[2], model: m[3] || '' });
    }
    return out;
}
// Decide which device to use. Auto-switching is only allowed when the
// configured device is online, or the configured serial is a network device
// and exactly one network device is online (same phone, new DHCP address).
// Any other case returns an empty serial so the user picks explicitly.
export function pickDevice(list, configured) {
    const online = (list || []).filter(d => d.state === 'device');
    if (configured && online.some(d => d.serial === configured)) {
        return { serial: configured, source: 'configured', online };
    }
    const isNet = (s) => String(s || '').includes(':');
    if (isNet(configured)) {
        const nets = online.filter(d => isNet(d.serial));
        if (nets.length === 1) {
            return { serial: nets[0].serial, source: 'dhcp', online };
        }
    }
    return { serial: '', source: '', online };
}
export function parseAdbVersion(out) {
    const m = /Android Debug Bridge version\s+([\w.-]+)/i.exec(out || '');
    return m ? m[1] : '';
}
export function parseScrcpyVersion(out) {
    const m = /scrcpy\s+([\w.-]+)/i.exec(out || '');
    return m ? m[1] : '';
}
// Human-readable scrcpy exit reason for the panel.
export function describeExit(code) {
    if (code === 0)
        return '投屏窗口已关闭';
    if (code === 1)
        return 'scrcpy 启动失败（看日志）';
    if (code === 2)
        return 'scrcpy 参数或设备有问题';
    if (code === 3221225620) {
        return 'scrcpy 崩溃了（0xC0000005，通常是端口/驱动冲突）';
    }
    return `scrcpy 退出（代码 ${code}）`;
}
