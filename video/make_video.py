"""Build the 1-minute eZstudy promo video from PPTS/*.png.

Steps: TTS narration per sentence (edge-tts) -> timeline -> render frames
(slow zoom, crossfade, burned-in subtitles) -> mux with ffmpeg.
Run:  python video/make_video.py
"""
import asyncio, os, subprocess, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import edge_tts, imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLIDES = os.path.join(ROOT, "PPTS")
OUT = os.path.join(ROOT, "video")
TMP = os.path.join(OUT, "_build_en" if "--en" in sys.argv else "_build")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "zh-TW-HsiaoChenNeural"
RATE = "+18%"
SR = 24000
FPS = 30
W, H = 1920, 1080
FONT = "C:/Windows/Fonts/msjhbd.ttc"

# (slide number, narration sentence). Slide 4 (title overlap glitch) and
# slide 9 (live stats, still small) are left out on purpose.
SCRIPT = [
    (1, "這是 eZstudy：把任何講義，變成會批改、會出題、會陪你複習的學習空間。"),
    (2, "學習資料很多，但考卷對完就收起來，錯題沒被收集，下次一樣錯。"),
    (3, "eZstudy 的做法很簡單：一份 Markdown，就是一整套學習工具。"),
    (3, "同一份文件，同時是筆記、考卷、錯題本，也是 AI 家教的教材。"),
    (5, "會打字就會出題：寫好題目和答案，作答完立刻自動批改。"),
    (6, "AI 家教先選範圍、再選技能，英文、文言文、數理都行，結果存回你的教材。"),
    (7, "還有螢光筆、朗讀、背誦模式；老師發布資料夾，學生一鍵轉入。"),
    (8, "資料屬於你，能匯出 PDF 和 Word；手機加入主畫面，隨時練習。"),
    (10, "下一步，讓每個學生都有一位懂自己教材的 AI 助教。立即體驗 eZstudy！"),
]
SCRIPT_EN = [
    (1, "This is eZstudy. It turns any handout into a study space that grades you, quizzes you, and helps you review."),
    (2, "There's plenty of study material, but once a test is graded, it gets filed away. Mistakes are never collected, so they repeat."),
    (3, "eZstudy's idea is simple: one Markdown file is your notes, your test, your mistake log, and your AI tutor's material."),
    (4, "Read, mark, write, check, fix, and practice, all in one document."),
    (5, "If you can type, you can write a test. Answers are graded instantly."),
    (6, "The AI tutor works on the scope and skill you pick, then saves the results back into your notes."),
    (7, "Teachers publish study folders, and students import them in one click."),
    (8, "Your data stays yours. Export to PDF or Word, and practice on your phone."),
    (10, "Our vision: every student gets an AI tutor that knows their own material. Try eZstudy today!"),
]
EN = "--en" in sys.argv
if EN:
    SCRIPT, VOICE, RATE = SCRIPT_EN, "en-US-AvaNeural", "+5%"
    SLIDES = os.path.join(ROOT, "PPTS_EN")
    FONT = "C:/Windows/Fonts/segoeuib.ttf"
NAME = "ezstudy-1min-en" if EN else "ezstudy-1min"
GAP = 0.2          # pause after each sentence
SLIDE_GAP = 0.3    # extra pause when the slide changes
INTRO = 0.6         # silent lead-in
OUTRO = 1.2         # hold on last slide
XFADE = 0.45


async def tts(text, path):
    await edge_tts.Communicate(text, VOICE, rate=RATE).save(path)


def decode(path):
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-f", "s16le",
                          "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16)


def clean(img):
    """Paint over presenter UI (nav bar, key hints, page number) by
    interpolating each row between the pixels just outside the box."""
    a = np.asarray(img).astype(np.float32).copy()
    for x0, y0, x1, y1 in [(765, 990, 1155, 1066), (1530, 12, 1912, 50),
                           (1700, 992, 1810, 1040)]:
        left, right = a[y0:y1, x0 - 2], a[y0:y1, x1 + 2]
        t = np.linspace(0, 1, x1 - x0)[None, :, None]
        a[y0:y1, x0:x1] = left[:, None] * (1 - t) + right[:, None] * t
    return Image.fromarray(a.astype(np.uint8))


def wrap(text, font, maxw, draw):
    if " " in text and text.isascii():          # English: wrap on words, balance lines
        words = text.split()
        n = 1
        while True:
            target = len(text) / n
            lines, cur = [], ""
            for w in words:
                if cur and len(cur) + 1 + len(w) > target + 6:
                    lines.append(cur); cur = w
                else:
                    cur = (cur + " " + w).strip()
            lines.append(cur)
            if all(draw.textlength(l, font=font) <= maxw for l in lines):
                return lines
            n += 1
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=font) > maxw and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    # rebalance two lines so the second isn't a stub
    if len(lines) == 2 and len(lines[1]) < len(lines[0]) // 2:
        s = text; mid = len(s) // 2
        for d in range(0, mid):
            for k in (mid + d, mid - d):
                if 0 < k < len(s) and s[k - 1] in "，、：；。！":
                    return [s[:k], s[k:]]
    return lines


def subtitle_layer(text):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    font = ImageFont.truetype(FONT, 46)
    lines = wrap(text, font, 1500, d)
    lh = 64
    widths = [d.textlength(l, font=font) for l in lines]
    bw, bh = max(widths) + 70, lh * len(lines) + 34
    bx, by = (W - bw) / 2, H - 70 - bh
    d.rounded_rectangle([bx, by, bx + bw, by + bh], 18, fill=(8, 10, 24, 200))
    for i, l in enumerate(lines):
        x = (W - widths[i]) / 2
        y = by + 17 + i * lh
        d.text((x, y), l, font=font, fill=(255, 255, 255, 255),
               stroke_width=2, stroke_fill=(0, 0, 0, 255))
    return layer


def main():
    os.makedirs(TMP, exist_ok=True)
    # 1. narration
    clips = []
    for i, (_, text) in enumerate(SCRIPT):
        p = os.path.join(TMP, f"line{i}.mp3")
        asyncio.run(tts(text, p))
        clips.append(decode(p))

    # 2. timeline
    audio = [np.zeros(int(INTRO * SR), np.int16)]
    t = INTRO
    subs, slide_spans = [], []
    for i, ((slide, text), pcm) in enumerate(zip(SCRIPT, clips)):
        if not slide_spans or slide_spans[-1][0] != slide:
            if slide_spans:
                audio.append(np.zeros(int(SLIDE_GAP * SR), np.int16)); t += SLIDE_GAP
                slide_spans[-1][2] = t
            slide_spans.append([slide, t if slide_spans else 0.0, None])
        dur = len(pcm) / SR
        subs.append((t, t + dur, text))
        audio.append(pcm); t += dur
        audio.append(np.zeros(int(GAP * SR), np.int16)); t += GAP
    total = t + OUTRO
    slide_spans[-1][2] = total
    audio.append(np.zeros(int(OUTRO * SR), np.int16))
    pcm = np.concatenate(audio)
    wav = os.path.join(TMP, "narration.raw")
    pcm.tofile(wav)
    print(f"total length: {total:.1f}s")
    if "--measure" in sys.argv:
        for s in subs:
            print(f"{s[0]:6.2f}-{s[1]:6.2f} {s[2]}")
        return

    # SRT for YouTube captions
    def ts(x):
        ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"
    with open(os.path.join(OUT, NAME + ".srt"), "w", encoding="utf-8") as f:
        for n, (a, b, text) in enumerate(subs, 1):
            f.write(f"{n}\n{ts(a)} --> {ts(b)}\n{text}\n\n")

    # 3. frames
    slides = {s: (lambda im: im if EN else clean(im))(Image.open(os.path.join(SLIDES, f"{s}.png")).convert("RGB").resize((W, H)))
              for s, _, _ in slide_spans}
    sub_layers = [subtitle_layer(text) for _, _, text in subs]

    def slide_frame(idx, tt):
        s, a, b = slide_spans[idx]
        p = min(max((tt - a) / max(b - a, 0.01), 0), 1)
        z = 1.0 + 0.035 * p
        cw, ch = W / z, H / z
        box = ((W - cw) / 2, (H - ch) / 2, (W + cw) / 2, (H + ch) / 2)
        return slides[s].resize((W, H), Image.BILINEAR, box=box)

    out = os.path.join(OUT, NAME + ".mp4")
    cmd = [FFMPEG, "-y", "-v", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", wav,
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    nframes = int(total * FPS)
    for n in range(nframes):
        tt = n / FPS
        idx = next(i for i, sp in enumerate(slide_spans) if tt < sp[2] or i == len(slide_spans) - 1)
        frame = slide_frame(idx, tt)
        end = slide_spans[idx][2]
        if idx + 1 < len(slide_spans) and tt > end - XFADE:
            frame = Image.blend(frame, slide_frame(idx + 1, tt), (tt - (end - XFADE)) / XFADE)
        frame = frame.convert("RGBA")
        for (a, b, _), layer in zip(subs, sub_layers):
            if a - 0.05 <= tt < b + GAP * 0.8:
                frame.alpha_composite(layer)
        frame = frame.convert("RGB")
        fade = min(tt / 0.5, (total - tt) / 0.8, 1.0)
        if fade < 1:
            frame = Image.blend(Image.new("RGB", (W, H)), frame, max(fade, 0))
        proc.stdin.write(frame.tobytes())
        if n % 300 == 0:
            print(f"frame {n}/{nframes}")
    proc.stdin.close(); proc.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
