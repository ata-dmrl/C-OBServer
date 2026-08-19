#!/usr/bin/env python3
"""
USB capture teşhis aracı — Pi 5 üzerinde ilk çalıştırılacak şey.

    python3 capture_check.py                    # tüm cihazları tara
    python3 capture_check.py --device /dev/video0
    python3 capture_check.py --device /dev/v4l/by-id/usb-XXXX-video-index0

Ne yapar:
  1. Mevcut video cihazlarını listeler (sabit by-id yollarıyla birlikte)
  2. Desteklenen format/çözünürlükleri gösterir
  3. Kare yakalayıp gerçek çözünürlük ve FPS'i ölçer
  4. HDCP / sinyal yok durumunu otomatik tespit eder
  5. Örnek kareleri diske yazar

Kurulum:
    sudo apt install v4l-utils python3-opencv
"""

from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
import time

import cv2
import numpy as np


def sh(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
    except Exception as e:
        return f"(çalıştırılamadı: {e})"


def list_devices() -> list[str]:
    print("=" * 62)
    print("1. VIDEO CIHAZLARI")
    print("=" * 62)

    out = sh(["v4l2-ctl", "--list-devices"])
    print(out.strip() or "(v4l2-ctl yok — sudo apt install v4l-utils)")

    print("\n--- Sabit yollar (/dev/v4l/by-id) ---")
    print("Worker'da BUNLARI kullan. /dev/videoN reboot'ta değişir,")
    print("makine kimliğinin karışması demektir.\n")
    by_id = sorted(glob.glob("/dev/v4l/by-id/*"))
    if by_id:
        for p in by_id:
            target = os.path.realpath(p)
            print(f"  {p}\n      -> {target}")
    else:
        print("  (bulunamadı)")

    return sorted(glob.glob("/dev/video*"))


def show_formats(dev: str) -> None:
    print("\n" + "=" * 62)
    print(f"2. DESTEKLENEN FORMATLAR — {dev}")
    print("=" * 62)
    out = sh(["v4l2-ctl", "-d", dev, "--list-formats-ext"])
    print(out.strip() or "(okunamadı)")

    if "MJPG" in out or "Motion-JPEG" in out:
        print(">>> MJPG destekleniyor. Bunu kullanacağız — YUYV çok daha")
        print("    fazla USB bant genişliği yer, 10 cihazda sorun çıkarır.")
    else:
        print(">>> MJPG YOK. Sadece ham format varsa USB bant genişliği")
        print("    kısıtı olacak, cihaz başına düşen çözünürlüğü düşürmek gerekebilir.")


def diagnose(frame: np.ndarray) -> tuple[bool, str]:
    """Karenin kullanılabilir olup olmadığına karar ver."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mean, std = float(gray.mean()), float(gray.std())
    b, g, r = [float(frame[:, :, i].mean()) for i in range(3)]

    if std < 3:
        if mean < 12:
            return False, ("SIYAH KARE — HDCP koruması veya sinyal yok. "
                           "Kaynak HDCP'liyse bu yolla ilerlenemez.")
        return False, f"DUZ KARE (std={std:.1f}) — sinyal yok veya donmuş görüntü."

    if g > b * 1.8 and g > r * 1.8:
        return False, "YESIL KARE — tipik HDCP/senkron hatası."

    if std < 12:
        return True, f"ZAYIF KONTRAST (std={std:.1f}) — görüntü var ama kontrol et."

    return True, f"GORUNTU VAR (ortalama={mean:.0f}, std={std:.1f})"


def test_capture(dev: str, width: int, height: int, mjpg: bool,
                 n: int = 30) -> None:
    print("\n" + "=" * 62)
    print(f"3. YAKALAMA TESTI — {dev}")
    print("=" * 62)

    cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
    if not cap.isOpened():
        print("!! Cihaz açılamadı. Başka bir süreç kullanıyor olabilir,")
        print("   ya da izin sorunu var (kullanıcıyı video grubuna ekle:")
        print("   sudo usermod -aG video $USER  — sonra çıkış/giriş)")
        return

    if mjpg:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    for _ in range(5):          # ilk kareler genelde çöp
        cap.read()

    ok, frame = cap.read()
    if not ok or frame is None:
        print("!! Kare alınamadı. Kaynak bağlı mı, HDMI hattı aktif mi?")
        cap.release()
        return

    h, w = frame.shape[:2]
    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
    fourcc_s = "".join(chr((fourcc >> (8 * i)) & 0xFF) for i in range(4))

    print(f"  çözünürlük : {w}x{h}   (istenen {width}x{height})")
    print(f"  format     : {fourcc_s}")
    print(f"  bildirilen FPS: {cap.get(cv2.CAP_PROP_FPS):.1f}")

    t0, got = time.time(), 0
    for _ in range(n):
        ok, f2 = cap.read()
        if ok and f2 is not None:
            got, frame = got + 1, f2
    elapsed = time.time() - t0
    print(f"  ölçülen FPS: {got/elapsed:.1f}  ({got}/{n} kare, {elapsed:.1f} sn)")

    usable, msg = diagnose(frame)
    print(f"\n  >>> {msg}")

    os.makedirs("capture_samples", exist_ok=True)
    name = dev.replace("/", "_").strip("_")
    path = f"capture_samples/{name}.png"
    cv2.imwrite(path, frame)
    print(f"  kare kaydedildi: {path}")

    if usable:
        # ROI ölçümü için birkaç kare daha
        for i in range(3):
            time.sleep(1.0)
            ok, f3 = cap.read()
            if ok:
                cv2.imwrite(f"capture_samples/{name}_t{i+1}.png", f3)
        print("  ROI ölçümü için 3 kare daha kaydedildi (1 sn arayla)")
        print("\n  SONRAKI ADIM: bu kareleri gönder, ROI koordinatlarını")
        print("  yeni çözünürlüğe göre yeniden çıkaralım.")
    else:
        print("\n  DUR. Bu sorun çözülmeden ilerleme.")

    cap.release()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", help="belirli bir cihaz; boşsa hepsi taranır")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--no-mjpg", action="store_true")
    args = ap.parse_args()

    devices = list_devices()

    targets = [args.device] if args.device else devices
    if not targets:
        sys.exit("\nHiç video cihazı yok. Capture takılı mı? dmesg | tail -20")

    for dev in targets:
        if not os.path.exists(dev):
            print(f"\n!! {dev} bulunamadı")
            continue
        show_formats(dev)
        test_capture(dev, args.width, args.height, not args.no_mjpg)


if __name__ == "__main__":
    main()
