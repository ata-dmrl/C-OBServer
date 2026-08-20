#!/usr/bin/env python3
"""
Olay motorunu capture olmadan test et.

Gerçek bir vardiya senaryosu üretir: normal üretim, iki duruş,
bir model değişimi, bir sayaç resetı, bir kalite düşüşü, bir sinyal kaybı.
Zaman hızlandırılmış — 1 saniyelik örnekleme, 2 saatlik vardiya
gerçek zamanda saniyeler içinde koşar.

    python simulate.py
    python simulate.py --hours 4 --seed 7
"""

from __future__ import annotations

import argparse
import random
import time

from events import MachineConfig, MachineEngine, EventType
from parsing import Reading


def make_reading(total, good, model, rate=None, speed=200) -> Reading:
    r = Reading()
    r.total, r.good, r.model = total, good, model
    r.rate = rate if rate is not None else (good / total * 100 if total else 0)
    r.runtime = round(total / 10000, 1)
    r.speed = speed
    return r


def scenario(hours: float, seed: int):
    """(ts_offset, reading|None) çiftleri üretir. None = geçersiz okuma."""
    rng = random.Random(seed)
    t = 0.0
    total, good = 43624, 42909
    model = "Type-M"
    step = 1.0
    end = hours * 3600

    # olayları vardiyaya serpiştir
    downtimes = sorted(rng.sample(range(300, int(end) - 600, 60), 2))
    dt_len = [rng.randint(90, 400) for _ in downtimes]
    model_change_at = int(end * 0.55)
    signal_loss_at = int(end * 0.8)
    quality_dip = (int(end * 0.3), int(end * 0.3) + 500)

    stopped_until = -1
    while t < end:
        ti = int(t)

        for start, length in zip(downtimes, dt_len):
            if start <= ti < start + length:
                stopped_until = start + length

        if signal_loss_at <= ti < signal_loss_at + 40:
            yield t, None
            t += step
            continue

        if ti == model_change_at:
            model = "Type-K"
            total, good = 0, 0

        running = ti >= stopped_until
        if running:
            rate_now = rng.randint(2, 4)
            total += rate_now
            bad = 1 if rng.random() < (0.06 if quality_dip[0] <= ti < quality_dip[1] else 0.012) else 0
            good += max(0, rate_now - bad)

        speed = rng.randint(190, 215) if running else 0
        yield t, make_reading(total, good, model, speed=speed)
        t += step


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=2.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--stall", type=float, default=30.0)
    ap.add_argument("--nominal", type=float, default=11000, help="adet/saat")
    args = ap.parse_args()

    cfg = MachineConfig(machine_id="MAK-01", stall_seconds=args.stall,
                        nominal_rate=args.nominal)
    eng = MachineEngine(cfg)

    t0 = time.time()
    log: list = []
    last_ts = t0

    for offset, reading in scenario(args.hours, args.seed):
        ts = t0 + offset
        last_ts = ts
        for ev in eng.update(reading, ts):
            log.append(ev)
            if not ev.open:
                print(" ", ev)

    print(f"\n--- {args.hours} saatlik vardiya, {cfg.machine_id} ---")
    # _open ve _close aynı nesneyi döndürür, log'da iki kez görünür
    seen, closed = set(), []
    for e in log:
        if not e.open and id(e) not in seen:
            seen.add(id(e))
            closed.append(e)
    for kind in EventType:
        n = sum(1 for e in closed if e.type is kind)
        if n:
            secs = sum(e.duration or 0 for e in closed if e.type is kind)
            print(f"  {kind.value:16s} {n:3d} adet   toplam {secs/60:6.1f} dk")

    m = eng.oee(last_ts)
    if m:
        print(f"\n  üretim        {m['uretim']:,} adet")
        print(f"  duruş         {m['downtime_s']/60:.1f} dk / {m['planned_s']/60:.1f} dk")
        print(f"  Availability  {m['availability']*100:.1f}%")
        print(f"  Performance   {m['performance']*100:.1f}%" if m.get("performance") else "")
        print(f"  Quality       {m['quality']*100:.1f}%")
        if "oee" in m:
            print(f"  OEE           {m['oee']*100:.1f}%")
    print(f"  son durum     {eng.status.value}")


if __name__ == "__main__":
    main()
