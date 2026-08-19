#!/usr/bin/env python3
"""
ROI'lerin doğru yere oturduğunu gözle doğrula.

    python check_rois.py ekrantv.png

İki çıktı üretir:
  roi_overlay.png  — kutular görselin üstünde
  roi_strips.png   — kırpıklar alt alta, büyütülmüş

HDMI capture'a geçince çözünürlük değişecek. O zaman bu scripti
yeni bir kareyle çalıştır: oranlama doğru çalışıyorsa kutular
yine yerine oturur. Oturmuyorsa rois.py'deki REF_W/REF_H'i
yeni referansa göre güncelle.
"""

import sys

import cv2
import numpy as np

from rois import scaled_rois, crop_fields

COLORS = [(0, 220, 255), (0, 255, 120), (255, 120, 0), (255, 0, 200), (120, 200, 255)]


def main(path: str):
    img = cv2.imread(path)
    if img is None:
        sys.exit(f"okunamadı: {path}")
    h, w = img.shape[:2]
    print(f"görsel: {w}x{h}")

    overlay = img.copy()
    for i, (name, (x1, y1, x2, y2)) in enumerate(scaled_rois(w, h).items()):
        c = COLORS[i % len(COLORS)]
        cv2.rectangle(overlay, (x1, y1), (x2, y2), c, 2)
        cv2.putText(overlay, name, (x1, max(18, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, c, 2)
    cv2.imwrite("roi_overlay.png", overlay)

    strips, width = [], 520
    for name, crop in crop_fields(img).items():
        if crop.size == 0:
            print(f"UYARI: {name} boş kırpık")
            continue
        s = width / crop.shape[1]
        strips.append(cv2.resize(crop, (width, int(crop.shape[0] * s)),
                                 interpolation=cv2.INTER_LANCZOS4))
        strips.append(np.full((6, width, 3), 255, np.uint8))
    if strips:
        cv2.imwrite("roi_strips.png", np.vstack(strips))

    print("yazıldı: roi_overlay.png, roi_strips.png")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "ekrantv.png")
