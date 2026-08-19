#!/usr/bin/env python3
"""
Gerçek capture karesinden test videosu üretir.

Elde tek bir durağan ekran görüntüsü varken duruş tespitinin kapanışı
test edilemiyor — sayacın artması gerekiyor. Bu script gerçek kareyi alıp
sayaç alanlarını yeniden çizerek senaryolu bir video üretir.

Senaryo (varsayılan 6 dakika):
    0:00 - 1:30   üretim var, sayaç artıyor
    1:30 - 3:00   sayaç donuyor        -> 30 sn sonra DURUS açılmalı
    3:00 - 4:30   üretim geri geliyor  -> DURUS kapanmalı
    4:30 - 5:00   model değişimi + sayaç reset -> MODEL_DEGISIMI, SAYAC_RESET
    5:00 - 6:00   yeni modelde üretim

Kullanım:
    python3 make_test_video.py --frame gercek.png --out test.mp4

Sonra laptopta tam ekran oynat (VLC: Video > Tam Ekran, döngü açık).
Pi bunu gerçek makine gibi görecek.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

# rois.py ile aynı koordinatlar (1920x1080 referans)
ROIS = {
    "model":   (1368, 196, 1858, 320),
    "total":   (1420, 352, 1857, 480),
    "good":    (1416, 512, 1853, 638),
    "rate":    (1380, 672, 1848, 796),
    "runtime": (1408, 832, 1843, 955),
    "speed":   (325, 372, 705, 566),
}

PANEL_BG = (163, 105, 46)      # BGR — pano mavisi, kareden örneklendi
TEXT = (255, 255, 255)
RED = (60, 60, 214)            # kadran rakamının kırmızısı
DIGIT_H = 71                   # gerçek karedeki rakam yüksekliği (piksel)

FONT = cv2.FONT_HERSHEY_DUPLEX


def draw_value(img, roi, text, color=TEXT, align="right", outline=None):
    """ROI içindeki değeri sil ve yenisini yaz."""
    x1, y1, x2, y2 = ROIS[roi]
    # beyaz kutu kenarına dokunma, içini boya
    pad = 10
    img[y1 + pad:y2 - pad, x1 + pad:x2 - pad] = PANEL_BG

    scale = 2.4
    thick = 4
    (tw, th), _ = cv2.getTextSize(text, FONT, scale, thick)
    # gerçek rakam yüksekliğine ölçekle
    scale *= DIGIT_H / max(th, 1)
    (tw, th), _ = cv2.getTextSize(text, FONT, scale, thick)

    cy = (y1 + y2) // 2 + th // 2
    if align == "right":
        cx = x2 - pad - 14 - tw
    else:
        cx = (x1 + x2) // 2 - tw // 2

    if outline:
        cv2.putText(img, text, (cx, cy), FONT, scale, outline, thick + 6, cv2.LINE_AA)
    cv2.putText(img, text, (cx, cy), FONT, scale, color, thick, cv2.LINE_AA)


def build_frame(base, total, good, model, speed, runtime_h):
    img = base.copy()
    rate = good / total * 100 if total else 0.0
    draw_value(img, "total", str(total))
    draw_value(img, "good", str(good))
    draw_value(img, "rate", f"{rate:.2f}%")
    draw_value(img, "runtime", f"{runtime_h:.1f}h")
    draw_value(img, "model", model, align="center")
    draw_value(img, "speed", str(speed), color=RED, align="center", outline=TEXT)
    return img


def scenario(seconds: int, fps: int):
    """(t, total, good, model, speed) üretir."""
    total, good = 43624, 42909
    model = "Type-M"
    seg = seconds / 6.0

    for i in range(seconds * fps):
        t = i / fps
        if t < seg * 1.5:                      # üretim
            running = True
        elif t < seg * 3:                      # duruş
            running = False
        elif t < seg * 4.5:                    # üretim
            running = True
        elif t < seg * 5:                      # model değişimi
            if model == "Type-M":
                model, total, good = "Type-K", 0, 0
            running = True
        else:
            running = True

        if running and i % fps == 0:           # saniyede ~3 adet
            total += 3
            good += 3 if i % (fps * 8) else 2  # ara sıra fire
        yield t, total, good, model, (198 if running else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", default="gercek.png", help="gerçek capture karesi")
    ap.add_argument("--out", default="test.mp4")
    ap.add_argument("--seconds", type=int, default=360)
    ap.add_argument("--fps", type=int, default=5)
    args = ap.parse_args()

    base = cv2.imread(args.frame)
    if base is None:
        raise SystemExit(f"okunamadı: {args.frame}")
    if base.shape[1] != 1920:
        base = cv2.resize(base, (1920, 1080))

    tmp = Path(tempfile.mkdtemp())
    n = 0
    for t, total, good, model, speed in scenario(args.seconds, args.fps):
        img = build_frame(base, total, good, model, speed, 4.1 + t / 3600)
        cv2.imwrite(str(tmp / f"f_{n:06d}.png"), img)
        n += 1

    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(args.fps), "-i", str(tmp / "f_%06d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        args.out,
    ], check=True)

    print(f"{args.out} hazır — {n} kare, {args.seconds} sn")
    print("Laptopta tam ekran ve döngüde oynat.")


if __name__ == "__main__":
    main()
