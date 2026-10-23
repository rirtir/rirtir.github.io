"""保存先とデータの読み書き。録音や結果は公開しない場所（.local/mml_verify/）に置く。"""
import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ['MML_VERIFY_DATA']) if os.environ.get('MML_VERIFY_DATA') else ROOT / '.local' / 'mml_verify'
SESSIONS = DATA / 'sessions'
RESULTS = DATA / 'results.jsonl'
CONFIG = DATA / 'config.json'
PROBES = DATA / 'probes'


def ensure():
    for d in (DATA, SESSIONS, PROBES):
        d.mkdir(parents=True, exist_ok=True)


def load_config():
    ensure()
    if CONFIG.exists():
        try:
            return json.loads(CONFIG.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def save_config(cfg):
    ensure()
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')


def new_session_id(tag=''):
    ensure()
    sid = time.strftime('%Y%m%d-%H%M%S')
    if tag:
        sid += '-' + ''.join(c for c in tag if c.isalnum() or c in '-_')[:24]
    return sid


def session_dir(sid):
    d = SESSIONS / sid
    d.mkdir(parents=True, exist_ok=True)
    return d


def append_result(rec):
    ensure()
    with open(RESULTS, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def load_results():
    if not RESULTS.exists():
        return []
    out = []
    for line in RESULTS.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out
