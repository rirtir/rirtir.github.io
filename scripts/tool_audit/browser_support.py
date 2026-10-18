"""ツール点検用のローカル配信。公開ファイル自体は変更しない。"""
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading

REPO = Path(__file__).resolve().parents[2]
ARTIFACTS = REPO / '.local/tool-audit'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def guess_type(self, path):
        if path.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)


@contextmanager
def local_server():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(REPO)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
