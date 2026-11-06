# Standalone debug helper: a tiny HTTP server that appends every notification
# POST to a plain JSONL file.
#
# DEPRECATED as the production receiver. The plugin now handles notification
# delivery in-process via HttpNotificationSource
# (src/infrastructure/notifications/http-notification-source.ts): it binds
# 0.0.0.0:14123, maps POST bodies to NotificationEvent, appends to
# <dataDir>/notifications/received.log and feeds the 5-layer filter pipeline.
#
# Kept here for manual debugging only. Do NOT run it alongside the plugin:
# both try to bind port 14123 and the second one will fail.
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# Debug log path: defaults next to this script, override with DQY_NOTIFY_LOG.
LOG = os.environ.get(
    "DQY_NOTIFY_LOG",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "notify-received.log"),
)

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8", "replace")
        try:
            obj = json.loads(body)
        except Exception:
            obj = {"raw": body}
        line = json.dumps({"t": time.strftime("%H:%M:%S"), "path": self.path, **obj}, ensure_ascii=False)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *a):
        pass

HTTPServer(("0.0.0.0", 14123), H).serve_forever()
