#!/usr/bin/env python3
"""
Ham skorları yuvarlamadan bas + kademeleri yan yana koy.

    python raw_scores.py ekrantv.png
"""
import sys
import cv2
from rois import crop_fields
from readers import RapidReader

img = cv2.imread(sys.argv[1] if len(sys.argv) > 1 else "ekrantv.png")
crops = crop_fields(img)

for tier in ("small", "medium"):
    r = RapidReader(tier)
    r.warmup(list(crops.values())[1])
    print(f"\n=== rapidocr[{tier}] ===")
    total_ms = 0.0
    for k, c in crops.items():
        t, s, ms = r.read(c)
        total_ms += ms
        print(f"  {k:8s} {t!r:>10}  skor={s!r:<22} {ms:6.1f} ms")
    print(f"  toplam {total_ms:.1f} ms")
