"""靜態檔案伺服器。這台電腦沒有裝 Node 時，用 py server.py 開啟墨習。"""

import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
    }


def free_port(start=5173):
    for port in range(start, start + 20):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit("找不到可用的連接埠")


if __name__ == "__main__":
    port = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Moxi http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
