#!/usr/bin/env python3
"""
Simülatör verisini API'ye besle. Capture donanımı olmadan
uçtan uca hattı test etmek için.

    # önce API çalışsın:  uvicorn api:app --port 8000
    python feed.py --machines 3 --hours 2 --speedup 600

--speedup: simülasyon hızı. 600 = 1 saniyelik veri 1/600 saniyede gönderilir,
yani 2 saatlik vardiya 12 saniyede biter.
"""

from __future__ import annotations

import argparse
import asyncio
import random

import httpx

from simulate import scenario


async def feed_machine(client: httpx.AsyncClient, url: str, machine_id: str,
                       hours: float, seed: int, speedup: float) -> int:
    sent = 0
    base = None
    for offset, reading in scenario(hours, seed):
        import time as _t
        if base is None:
            base = _t.time() - offset / speedup
        payload = {"machine_id": machine_id, "problems": []}
        if reading is None:
            payload["problems"] = ["okuma geçersiz"]
        else:
            payload.update(model=reading.model, total=reading.total,
                           good=reading.good, rate=round(reading.rate, 2),
                           runtime=reading.runtime, speed=reading.speed,
                           min_score=round(random.uniform(0.94, 1.0), 4))
        try:
            await client.post(url, json=payload, timeout=10)
            sent += 1
        except Exception as e:
            print(f"{machine_id}: gönderilemedi ({e})")
        await asyncio.sleep(1 / speedup)
    return sent


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--machines", type=int, default=3)
    ap.add_argument("--hours", type=float, default=2.0)
    ap.add_argument("--speedup", type=float, default=600)
    args = ap.parse_args()

    url = args.api.rstrip("/") + "/ingest"
    async with httpx.AsyncClient() as client:
        tasks = [
            feed_machine(client, url, f"MAK-{i+1:02d}", args.hours, 40 + i, args.speedup)
            for i in range(args.machines)
        ]
        results = await asyncio.gather(*tasks)
    print(f"gönderilen okuma: {sum(results)}")


if __name__ == "__main__":
    asyncio.run(main())
