"""Synthesize the original Lumina Isle soundtrack and effects.

Only Python's standard library and the repository workstation's ffmpeg binary are
needed. Every tone is generated here; no sample or third-party composition is used.
"""

from __future__ import annotations

import math
import random
import shutil
import struct
import subprocess
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BGM = ROOT / "assets" / "audio" / "bgm"
SFX = ROOT / "assets" / "audio" / "sfx"
TMP = ROOT / "assets" / "audio" / ".wav-build"
RATE = 22050
TAU = math.tau


def midi(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def new_mix(seconds):
    return [0.0] * int(seconds * RATE)


def envelope(t, duration, attack=.01, release=.12):
    return min(1.0, t / max(attack, 1e-4), (duration - t) / max(release, 1e-4))


def add_tone(buf, start, duration, freq, volume=.2, wave_type="sine", attack=.01, release=.12, pan=0.0):
    begin = max(0, int(start * RATE)); end = min(len(buf), int((start + duration) * RATE))
    phase = 0.0
    for i in range(begin, end):
        t = (i - begin) / RATE
        phase += freq / RATE
        p = phase % 1.0
        if wave_type == "triangle": value = 1.0 - 4.0 * abs(p - 0.5)
        elif wave_type == "square": value = 1.0 if p < .5 else -1.0
        elif wave_type == "marimba": value = math.sin(TAU*p) + .34*math.sin(TAU*p*3)*math.exp(-5*t) + .15*math.sin(TAU*p*6)*math.exp(-9*t)
        elif wave_type == "bell": value = math.sin(TAU*p) + .42*math.sin(TAU*p*2.01) + .16*math.sin(TAU*p*4.02)
        else: value = math.sin(TAU*p)
        env = envelope(t, duration, attack, release)
        if wave_type in ("marimba", "bell"): env *= math.exp(-2.6*t)
        buf[i] += value * volume * max(0.0, env)


def add_sweep(buf, start, duration, f0, f1, volume=.2, wave_type="sine"):
    begin = int(start * RATE); end = min(len(buf), int((start + duration) * RATE)); phase = 0.0
    for i in range(begin, end):
        t = (i - begin) / RATE; u = t / duration
        phase += (f0 * ((f1 / f0) ** u)) / RATE
        p = phase % 1.0
        value = math.sin(TAU*p) if wave_type == "sine" else (1 - 4*abs(p-.5))
        buf[i] += value * volume * math.sin(math.pi*u)


def add_noise(buf, start, duration, volume=.08, seed=1, color=.55):
    rng = random.Random(seed); begin = int(start*RATE); end = min(len(buf), int((start+duration)*RATE)); prev = 0.0
    for i in range(begin, end):
        t=(i-begin)/RATE; u=t/duration
        raw=rng.uniform(-1,1); prev=prev*color+raw*(1-color)
        buf[i] += prev*volume*math.sin(math.pi*u)


def normalize(buf, peak=.82, fade=.03):
    n = min(int(RATE*fade), len(buf)//2)
    for i in range(n):
        gain = math.sin((i/n)*math.pi/2) ** 2
        buf[i] *= gain; buf[-1-i] *= gain
    mx=max(.001,max(abs(v) for v in buf)); scale=min(1.0,peak/mx)
    return [max(-1,min(1,v*scale)) for v in buf]


def write_ogg(buf, target, quality=4):
    TMP.mkdir(parents=True,exist_ok=True); target.parent.mkdir(parents=True,exist_ok=True)
    wav_path=TMP/(target.stem+".wav")
    buf=normalize(buf)
    with wave.open(str(wav_path),"wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE)
        frames=bytearray()
        for v in buf: frames += struct.pack("<h",int(v*32767))
        out.writeframes(frames)
    subprocess.run(["ffmpeg","-loglevel","error","-y","-i",str(wav_path),"-c:a","libvorbis","-q:a",str(quality),str(target)],check=True)


def percussion(buf, beat, bars, seed=8, soft=False):
    for step in range(bars*16):
        t=step*beat/4
        if step%4==0:
            add_sweep(buf,t,.11,115 if not soft else 90,48,.10 if not soft else .055)
        if step%8==4: add_noise(buf,t,.09,.07 if not soft else .035,seed+step,.35)
        if step%2==1: add_noise(buf,t,.025,.018,seed*3+step,.1)


def meadow_day():
    bpm=104; beat=60/bpm; bars=12; duration=bars*4*beat; b=new_mix(duration)
    chords=[(60,64,67,71),(57,60,64,69),(55,59,62,67),(57,60,64,69)]
    melody=[72,76,79,76,74,72,69,71,72,74,76,79,81,79,76,74]
    for bar in range(bars):
        t=bar*4*beat; chord=chords[bar%4]
        for n in chord: add_tone(b,t,4*beat,midi(n),.026,"triangle",.4,.5)
        add_tone(b,t,beat*1.8,midi(chord[0]-12),.09,"triangle",.02,.25)
        add_tone(b,t+2*beat,beat*1.8,midi(chord[2]-12),.075,"triangle",.02,.25)
        for j in range(4):
            note=melody[(bar*4+j)%len(melody)]
            add_tone(b,t+j*beat,beat*.62,midi(note),.12,"marimba",.005,.1)
            if j in (1,3): add_tone(b,t+(j+.5)*beat,beat*.3,midi(note+7),.055,"bell",.005,.05)
    percussion(b,beat,bars,11,True); return b


def lantern_dusk():
    bpm=84; beat=60/bpm; bars=10; duration=bars*4*beat; b=new_mix(duration)
    chords=[(57,60,64),(55,59,62),(53,57,60),(55,59,64)]
    melody=[69,72,76,74,72,69,67,64,67,69,72,76]
    for bar in range(bars):
        t=bar*4*beat; chord=chords[bar%4]
        for n in chord: add_tone(b,t,4*beat,midi(n),.035,"sine",.65,.7)
        for j in range(6):
            n=melody[(bar*3+j)%len(melody)]
            add_tone(b,t+j*(beat*2/3),beat*.7,midi(n),.085,"bell",.02,.25)
        add_tone(b,t,2.8*beat,midi(chord[0]-12),.06,"triangle",.1,.5)
    percussion(b,beat,bars,22,True); return b


def guardian():
    bpm=122; beat=60/bpm; bars=12; duration=bars*4*beat; b=new_mix(duration)
    roots=[50,50,53,48,50,55,53,48]
    motif=[0,3,7,10,7,5,3,7]
    for bar in range(bars):
        t=bar*4*beat; root=roots[bar%len(roots)]
        for j in range(8):
            add_tone(b,t+j*beat/2,beat*.38,midi(root+motif[j]),.105,"marimba",.005,.06)
        add_tone(b,t,beat*1.5,midi(root-12),.13,"triangle",.01,.18)
        add_tone(b,t+2*beat,beat*1.5,midi(root-7),.11,"triangle",.01,.18)
        for n in (root,root+3,root+7): add_tone(b,t,4*beat,midi(n),.018,"sine",.3,.35)
    percussion(b,beat,bars,33,False); return b


def homecoming():
    bpm=88; beat=60/bpm; bars=8; duration=bars*4*beat; b=new_mix(duration)
    chords=[(60,64,67),(62,65,69),(64,67,71),(65,69,72),(57,60,64),(62,67,71),(60,64,69),(60,64,67,72)]
    for bar,chord in enumerate(chords):
        t=bar*4*beat
        for n in chord: add_tone(b,t,4*beat,midi(n),.045,"bell",.35,.6)
        for j,n in enumerate(chord): add_tone(b,t+j*beat*.7,beat*.8,midi(n+12),.11,"marimba",.01,.18)
        add_tone(b,t+2.5*beat,beat*.8,midi(chord[-1]+12),.08,"bell",.02,.2)
    for i in range(12): add_tone(b,duration-3+i*.18,.7,midi(72+(i%5)*2),.035,"bell",.01,.35)
    return b


def make_sfx(name):
    durations={"ui_confirm":.18,"ui_cancel":.18,"pickup":.28,"chop":.24,"mine":.28,"craft":.58,"build":.34,
               "fish_bite":.24,"fish_catch":.62,"attack":.20,"hit":.22,"dodge":.24,"cook":.55,"discover":.9,"sleep":.8}
    b=new_mix(durations[name])
    if name=="ui_confirm": add_tone(b,0,.12,660,.18,"marimba"); add_tone(b,.07,.11,880,.14,"marimba")
    elif name=="ui_cancel": add_sweep(b,0,.16,440,260,.14,"triangle")
    elif name=="pickup": add_tone(b,0,.2,784,.14,"bell"); add_tone(b,.08,.2,1175,.12,"bell")
    elif name=="chop": add_noise(b,0,.12,.24,4,.15); add_tone(b,.03,.18,145,.16,"triangle")
    elif name=="mine": add_tone(b,0,.24,920,.2,"bell",.001,.2); add_noise(b,.02,.09,.12,6,.1)
    elif name=="craft":
        for i,n in enumerate((60,64,67,72)): add_tone(b,i*.1,.25,midi(n+12),.12,"marimba")
    elif name=="build": add_noise(b,0,.12,.16,8,.2); add_tone(b,.1,.22,330,.14,"marimba")
    elif name=="fish_bite": add_sweep(b,0,.2,380,900,.16); add_noise(b,.05,.12,.06,10,.3)
    elif name=="fish_catch":
        for i,n in enumerate((67,72,76,79)): add_tone(b,i*.1,.3,midi(n),.12,"bell")
    elif name=="attack": add_sweep(b,0,.17,900,210,.18,"triangle"); add_noise(b,0,.14,.08,12,.3)
    elif name=="hit": add_noise(b,0,.18,.18,14,.12); add_tone(b,0,.15,120,.13,"triangle")
    elif name=="dodge": add_sweep(b,0,.22,250,700,.11); add_noise(b,0,.18,.05,16,.55)
    elif name=="cook":
        for i in range(4): add_noise(b,i*.1,.09,.05,20+i,.4)
        add_tone(b,.28,.25,660,.12,"marimba")
    elif name=="discover":
        for i,n in enumerate((60,67,72,76)): add_tone(b,i*.12,.5,midi(n),.13,"bell")
    elif name=="sleep": add_sweep(b,0,.75,520,180,.10); add_tone(b,.05,.6,659,.06,"sine",.15,.3)
    return b


def main():
    if not shutil.which("ffmpeg"): raise SystemExit("ffmpeg not found")
    tracks={"meadow-day":meadow_day,"lantern-dusk":lantern_dusk,"guardian":guardian,"homecoming":homecoming}
    for name,fn in tracks.items():
        print("BGM",name); write_ogg(fn(),BGM/f"{name}.ogg",5)
    for name in ("ui_confirm","ui_cancel","pickup","chop","mine","craft","build","fish_bite","fish_catch","attack","hit","dodge","cook","discover","sleep"):
        print("SFX",name); write_ogg(make_sfx(name),SFX/f"{name}.ogg",4)
    shutil.rmtree(TMP,ignore_errors=True)


if __name__=="__main__": main()
