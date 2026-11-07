"""Synthesize an original, royalty-free background track and mix it under
both videos (music ducks automatically while the narrator speaks).

Run:  python video/add_music.py
Output: video/ezstudy-1min-bgm.mp4, video/ezstudy-1min-en-bgm.mp4
"""
import os, subprocess
import numpy as np
import imageio_ffmpeg

OUT = os.path.dirname(os.path.abspath(__file__))
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


# Cmaj7 - G6 - Am7 - Fmaj7, one chord per bar
CHORDS = [[48, 52, 55, 59], [43, 47, 50, 52], [45, 48, 52, 55], [41, 45, 48, 52]]
BASS = [36, 31, 33, 29]


def tone(freq, dur, harmonics=6, detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * freq * h * (1 + detune) * t) / h
    return out


def env(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def build(total):
    n = int(total * SR)
    L = np.zeros(n); R = np.zeros(n)
    bars = int(np.ceil(total / BAR))

    def add(sig, start, gl, gr):
        i = int(start * SR)
        if i >= n: return
        sig = sig[: n - i]
        L[i:i + len(sig)] += sig * gl
        R[i:i + len(sig)] += sig * gr

    for b in range(bars):
        t0 = b * BAR
        chord, root = CHORDS[b % 4], BASS[b % 4]
        drums = 1 <= b < bars - 1
        # pad: two detuned voices, soft attack, overlaps into next bar
        for k, note in enumerate(chord):
            d = BAR + 0.6
            for det, (gl, gr) in ((-0.003, (0.9, 0.5)), (0.003, (0.5, 0.9))):
                s = tone(midi(note + 12), d, 5, det) * env(int(d * SR), 0.5, 0.8)
                add(s * 0.018, t0, gl, gr)
        # bass on beats 1 and 3
        for beat in (0, 2):
            d = BEAT * 1.8
            s = tone(midi(root), d, 2) * env(int(d * SR), 0.01, 0.3)
            s *= np.exp(-np.arange(len(s)) / SR * 1.2)
            add(s * 0.09, t0 + beat * BEAT, 0.8, 0.8)
        # plucked arpeggio, 8th notes, with ping-pong echo
        pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        for step, idx in enumerate(pattern):
            f = midi(chord[idx] + 24)
            d = 0.6
            tt = np.arange(int(d * SR)) / SR
            s = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 7)
            s[:200] *= np.linspace(0, 1, 200)
            st = t0 + step * BEAT / 2
            g = 0.05 if b > 0 else 0.03
            add(s * g, st, 0.75, 0.55)
            add(s * g * 0.45, st + BEAT * 0.75, 0.25, 0.8)
            add(s * g * 0.2, st + BEAT * 1.5, 0.8, 0.25)
        if drums:
            for beat in range(4):
                ts = t0 + beat * BEAT
                if beat in (0, 2):  # soft kick
                    tt = np.arange(int(0.35 * SR)) / SR
                    f = 50 + 70 * np.exp(-tt * 30)
                    k = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
                    add(k * 0.22, ts, 1, 1)
                else:  # rim-ish snap
                    tt = np.arange(int(0.15 * SR)) / SR
                    nz = rng.standard_normal(len(tt)) * np.exp(-tt * 35)
                    add(nz * 0.03, ts, 0.9, 1)
                # off-beat hat
                tt = np.arange(int(0.06 * SR)) / SR
                hz = np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 60)
                add(hz * 0.012, ts + BEAT / 2, 0.7, 1)

    mix = np.stack([L, R], 1)
    # gentle fade in / out and normalize
    fi, fo = int(1.5 * SR), int(3.0 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
    mix /= np.abs(mix).max() / 0.8
    return mix


def duration(path):
    out = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    h, m, s = out.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def main():
    for name in ("ezstudy-1min", "ezstudy-1min-en"):
        video = os.path.join(OUT, name + ".mp4")
        total = duration(video)
        music = build(total)
        raw = os.path.join(OUT, f"_music_{name}.raw")
        (music * 32767).astype(np.int16).tofile(raw)
        out = os.path.join(OUT, name + "-bgm.mp4")
        # music at ~-14 dB, ducked a further ~10 dB while the voice is speaking
        fc = ("[0:a]aformat=channel_layouts=stereo,asplit=2[v][sc];"
              "[1:a]volume=0.32[m];"
              "[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=500[md];"
              "[v][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", video,
                        "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", raw,
                        "-filter_complex", fc, "-map", "0:v", "-map", "[a]",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                        "-movflags", "+faststart", out], check=True)
        os.remove(raw)
        print("wrote", out)


if __name__ == "__main__":
    main()
