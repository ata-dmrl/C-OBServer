#!/usr/bin/env python3
"""
İki motoru aynı kırpıklar üzerinde karşılaştır.

Kullanım:

    # tek görsel, hızlı bakış
    python compare.py --image ekrantv.png

    # klasör dolusu kare + ground truth ile doğruluk ölçümü
    python compare.py --dir frames/ --truth truth.csv

truth.csv formatı:
    dosya,model,total,good,rate,runtime
    f_001.png,Type-M,43624,42909,98.36,4.1
"""

from __future__ import annotations

import argparse
import csv
import pathlib
import statistics
import sys

import cv2

from rois import crop_fields, VALUE_ROIS
from parsing import parse
import readers as R


FIELDS = list(VALUE_ROIS.keys())


def build(names: list[str]) -> list[R.BaseReader]:
    out = []
    for n in names:
        try:
            if n.startswith("rapid"):
                tier = n.split(":")[1] if ":" in n else "medium"
                out.append(R.RapidReader(model_type=tier))
            elif n.startswith("paddle"):
                out.append(R.PaddleReader())
            elif n.startswith("template"):
                out.append(R.TemplateReader())
        except Exception as e:
            print(f"[atlandı] {n}: {e}", file=sys.stderr)
    return out


def read_one(reader: R.BaseReader, img):
    crops = crop_fields(img)
    raw, scores, times = {}, {}, {}
    for name, crop in crops.items():
        text, score, ms = reader.read(crop)
        raw[name], scores[name], times[name] = text, score, ms
    return parse(raw, scores), times


def load_truth(path):
    truth = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            truth[row["dosya"]] = row
    return truth


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image")
    ap.add_argument("--dir")
    ap.add_argument("--truth")
    ap.add_argument("--engines", default="rapid:medium,rapid:small,paddle")
    args = ap.parse_args()

    paths = []
    if args.image:
        paths = [pathlib.Path(args.image)]
    elif args.dir:
        paths = sorted(p for p in pathlib.Path(args.dir).iterdir()
                       if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
    if not paths:
        ap.error("--image veya --dir ver")

    truth = load_truth(args.truth) if args.truth else {}
    engines = build([e.strip() for e in args.engines.split(",")])
    if not engines:
        sys.exit("hiçbir motor yüklenemedi")

    warm = cv2.imread(str(paths[0]))
    for e in engines:
        e.warmup(list(crop_fields(warm).values())[1])

    for eng in engines:
        hits = {f: 0 for f in FIELDS}
        seen = {f: 0 for f in FIELDS}
        all_times, bad_frames = [], 0

        for p in paths:
            img = cv2.imread(str(p))
            if img is None:
                continue
            reading, times = read_one(eng, img)
            all_times.append(sum(times.values()))
            if reading.problems:
                bad_frames += 1

            if len(paths) == 1:
                print(f"\n=== {eng.name} — {p.name} ===")
                for f in FIELDS:
                    print(f"  {f:9s} {reading.raw[f]!r:>14}  "
                          f"skor={reading.scores[f]:.3f}  {times[f]:6.1f} ms")
                print(f"  -> {reading.model} | {reading.total} | {reading.good} | "
                      f"{reading.rate} | {reading.runtime}")
                for pr in reading.problems:
                    print(f"  ! {pr}")

            exp = truth.get(p.name)
            if exp:
                got = {"model": reading.model, "total": reading.total,
                       "good": reading.good, "rate": reading.rate,
                       "runtime": reading.runtime}
                for f in FIELDS:
                    seen[f] += 1
                    want, have = exp[f].strip(), got[f]
                    if have is None:
                        continue
                    same = (str(have) == want or
                            (isinstance(have, float) and abs(have - float(want)) < 0.01))
                    hits[f] += int(same)

        if len(paths) > 1:
            print(f"\n=== {eng.name} — {len(paths)} kare ===")
            if truth:
                for f in FIELDS:
                    if seen[f]:
                        print(f"  {f:9s} doğruluk {hits[f]}/{seen[f]} "
                              f"({hits[f]/seen[f]*100:.1f}%)")
            print(f"  kare/sn  {1000/statistics.mean(all_times):.1f}")
            print(f"  ortalama {statistics.mean(all_times):.1f} ms  "
                  f"medyan {statistics.median(all_times):.1f} ms  "
                  f"en kötü {max(all_times):.1f} ms")
            print(f"  doğrulamadan geçemeyen kare: {bad_frames}/{len(paths)}")
            # 10 makine, saniyede 1 kare senaryosu
            print(f"  10 makine @1 FPS -> ~%{statistics.mean(all_times)/1000*10*100:.0f} "
                  f"tek çekirdek yükü")


if __name__ == "__main__":
    main()
