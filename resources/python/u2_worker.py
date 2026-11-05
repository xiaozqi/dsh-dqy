import json
import os
import sys

KEYCODES = {
    "back": 4,
    "home": 3,
    "recents": 187,
    "enter": 66,
}


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


def emit_unavailable(error):
    emit({"ok": False, "unavailable": True, "error": error})
    sys.exit(1)


def connect_device(cmd):
    adb = cmd.get("adb", "")
    serial = cmd.get("serial", "") or ""

    adb_dir = os.path.dirname(adb)
    if adb_dir:
        os.environ["PATH"] = adb_dir + os.pathsep + os.environ.get("PATH", "")
    if serial:
        os.environ["ANDROID_SERIAL"] = serial

    try:
        import uiautomator2 as u2
    except ImportError as exc:
        emit_unavailable("uiautomator2 not installed: %s" % exc)
        return None

    try:
        device = u2.Device(serial) if serial else u2.connect()
        _ = device.info
    except Exception as exc:
        emit_unavailable("cannot connect to device: %s" % exc)
        return None
    return device


def screen_size(device):
    try:
        width, height = device.window_size()
        return {"width": int(width), "height": int(height)}
    except Exception:
        info = device.info or {}
        return {
            "width": int(info.get("displayWidth", 0)),
            "height": int(info.get("displayHeight", 0)),
        }


def foreground(device):
    try:
        current = device.app_current()
        return current.get("package", "unknown")
    except Exception:
        return "unknown"


def main():
    cmd = json.loads(sys.argv[1])
    mode = cmd["mode"]

    device = connect_device(cmd)
    if device is None:
        return

    if mode == "ping":
        data = {"ok": True}
    elif mode == "observe":
        png_path = cmd["pngPath"]
        device.screenshot(png_path)
        xml = device.dump_hierarchy()
        data = {
            "xml": xml,
            "screenSize": screen_size(device),
            "foreground": foreground(device),
        }
    elif mode == "tap":
        device.tap(cmd["x"], cmd["y"])
        data = None
    elif mode == "long_press":
        seconds = float(cmd.get("durationMs", 800)) / 1000.0
        device.long_click(cmd["x"], cmd["y"], seconds)
        data = None
    elif mode == "swipe":
        seconds = float(cmd.get("durationMs", 300)) / 1000.0
        device.swipe(
            cmd["x1"], cmd["y1"], cmd["x2"], cmd["y2"], seconds
        )
        data = None
    elif mode == "input_text":
        try:
            device.set_fastinput_ime(True)
            device.send_keys(cmd["text"])
        except Exception:
            device.shell(["input", "text", cmd["text"]])
        data = None
    elif mode == "press_key":
        code = KEYCODES.get(cmd.get("key", ""), 0)
        device.press_keycode(code)
        data = None
    elif mode == "open_app":
        package = cmd["packageName"]
        try:
            device.app_start(package)
        except Exception:
            device.shell(
                [
                    "monkey",
                    "-p",
                    package,
                    "-c",
                    "android.intent.category.LAUNCHER",
                    "1",
                ]
            )
        data = None
    elif mode == "screen_size":
        data = screen_size(device)
    elif mode == "foreground":
        data = foreground(device)
    elif mode == "push":
        device.push(cmd["local"], cmd["remote"])
        data = None
    elif mode == "pull":
        device.pull(cmd["remote"], cmd["local"])
        data = None
    else:
        raise ValueError("unknown mode: %s" % mode)

    emit({"ok": True, "data": data})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        sys.exit(1)
