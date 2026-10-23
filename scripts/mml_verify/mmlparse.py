"""MML（マビノギ形式）を解析して、「どの音が何秒に鳴るはずか」の一覧にする。

MML@メロディ,和音1,和音2;  の形式。テンポ(t)はメロディのものを全パートに使う。
音高は o4 の c = MIDIノート60（C4）。
"""
import hashlib
import re

TPW = 192            # 全音符 = 192 tick
NOTE_SEMI = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}
PCNAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def midi_name(m):
    return f'{PCNAMES[m % 12]}{m // 12 - 1}'


def split_parts(mml):
    """全体の文字列を、パートごとの (本文, 全体の中での開始位置) に分ける。"""
    s = mml
    base = 0
    i = s.upper().find('MML@')
    if i >= 0:
        base = i + 4
        s = s[base:]
    j = s.find(';')
    if j >= 0:
        s = s[:j]
    parts, pos = [], 0
    for seg in s.split(','):
        parts.append((seg, base + pos))
        pos += len(seg) + 1
    return parts


def mml_hash(mml):
    norm = re.sub(r'\s+', '', mml).lower()
    return hashlib.sha1(norm.encode()).hexdigest()[:10]


def _dur_ticks(n, dots):
    return TPW / n * (2 - 2 ** -dots)


def parse_part(text, offset, part_index):
    """1パートを解析する。戻り値: (notes, tempo_events, warnings, end_tick)"""
    s = text.lower()
    i, t = 0, 0.0
    L, Ldots, o, vol = 4, 0, 4, 8
    notes, tempos, warns = [], [], []
    last = None          # 直前の音（タイ用）
    tie_pending = False

    def num():
        nonlocal i
        m = re.match(r'\d+', s[i:])
        if not m:
            return None
        i += len(m.group(0))
        return int(m.group(0))

    def dots():
        nonlocal i
        d = 0
        while i < len(s) and s[i] == '.':
            d += 1
            i += 1
        return d

    while i < len(s):
        c = s[i]
        start_i = i
        i += 1
        if c.isspace():
            continue
        if c in NOTE_SEMI:
            acc = 0
            while i < len(s) and s[i] in '+#-':
                acc += -1 if s[i] == '-' else 1
                i += 1
            n = num()
            d = dots()
            ln = n if n else L
            ticks = _dur_ticks(max(1, min(192, ln)), (d if n else Ldots + d))
            pitch = 12 * (o + 1) + NOTE_SEMI[c] + acc
            if tie_pending and last is not None and last['pitch'] == pitch and abs(last['start'] + last['dur'] - t) < 1e-6:
                last['dur'] += ticks
                last['ties'] += 1
                last['char_end'] = offset + i
            else:
                last = dict(part=part_index, pitch=pitch, start=t, dur=ticks, vol=vol, ties=1,
                            char_start=offset + start_i, char_end=offset + i, deflen=(L, Ldots))
                notes.append(last)
            tie_pending = False
            t += ticks
        elif c == 'r':
            n = num()
            d = dots()
            ln = n if n else L
            t += _dur_ticks(max(1, min(192, ln)), (d if n else Ldots + d))
            tie_pending = False
        elif c == '&':
            tie_pending = True
        elif c == 't':
            n = num()
            if n is not None:
                tempos.append((t, max(32, min(255, n))))
        elif c == 'l':
            n = num()
            if n:
                L = n
            Ldots = dots()
        elif c == 'o':
            n = num()
            if n is not None:
                o = max(1, min(8, n))
        elif c == 'v':
            n = num()
            if n is not None:
                vol = max(0, min(15, n))
        elif c == '>':
            o = min(8, o + 1)
        elif c == '<':
            o = max(1, o - 1)
        else:
            warns.append(f'解釈できない文字「{c}」（位置{offset + start_i}）を無視しました')
    return notes, tempos, warns, t


class Score:
    def __init__(self, mml):
        self.mml = mml
        self.hash = mml_hash(mml)
        self.notes, self.warnings = [], []
        parts = split_parts(mml)
        self.n_parts = len(parts)
        self.tempo_events = []
        ends = []
        per_part = []
        for k, (txt, off) in enumerate(parts):
            ns, tempos, warns, end = parse_part(txt, off, k)
            self.warnings += warns
            if k == 0:
                self.tempo_events = tempos
            elif tempos:
                self.warnings.append(f'パート{k}のテンポ指定は使いません（テンポはメロディのものを使います）')
            per_part.append(ns)
            ends.append(end)
        if not self.tempo_events or self.tempo_events[0][0] > 0:
            self.tempo_events.insert(0, (0.0, 120))
        # 秒に直す
        for k, ns in enumerate(per_part):
            for idx, n in enumerate(ns):
                n['idx'] = idx
                n['start_s'] = self.sec(n['start'])
                n['end_s'] = self.sec(n['start'] + n['dur'])
                n['dur_s'] = n['end_s'] - n['start_s']
                n['tempo'] = self.bpm_at(n['start'])
                n['text'] = mml[n['char_start']:n['char_end']]
                n['name'] = midi_name(n['pitch'])
                self.notes.append(n)
        self.notes.sort(key=lambda n: (n['start'], n['part']))
        for g, n in enumerate(self.notes):
            n['gid'] = g
        self.end_tick = max(ends) if ends else 0
        self.duration = self.sec(self.end_tick)

    def bpm_at(self, tick):
        b = self.tempo_events[0][1]
        for tk, bpm in self.tempo_events:
            if tk <= tick + 1e-9:
                b = bpm
        return b

    def sec(self, tick):
        """tick を秒に直す（テンポ変化を含む）"""
        total, prev_t, prev_b = 0.0, 0.0, self.tempo_events[0][1]
        for tk, bpm in self.tempo_events:
            if tk >= tick:
                break
            if tk > prev_t:
                total += (tk - prev_t) * 240.0 / prev_b / TPW
                prev_t = tk
            prev_b = bpm
        total += (tick - prev_t) * 240.0 / prev_b / TPW
        return total


if __name__ == '__main__':
    import sys
    sc = Score(sys.argv[1] if len(sys.argv) > 1 else 'MML@t100l4o4cdefg2,l1o3c;')
    print('parts', sc.n_parts, 'duration', round(sc.duration, 3), 'notes', len(sc.notes), sc.warnings)
    for n in sc.notes[:12]:
        print(n['part'], n['idx'], n['name'], round(n['start_s'], 3), round(n['dur_s'], 3), n['text'])
