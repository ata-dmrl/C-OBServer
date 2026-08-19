"""
Saha cihazından merkeze köprü.

Hocanın hattı okunan değeri ResultStore'a yazıyor ve orada bitiyor —
anlık durum var, geçmiş ve olay kavramı yok. Bu modül o noktadan
dallanıp değerleri merkezi API'ye gönderiyor.

Mimarideki yeri:

    Stabilizer -> ResultStore  (mevcut, dokunulmuyor)
                \\
                 -> IngestBridge -> POST /ingest -> olay motoru + veritabanı

Neden ayrı bir katman: alanlar tek tek, farklı zamanlarda stabil hale
geliyor. Merkeze ise bir arada, tutarlı bir set olarak gitmesi gerekiyor —
çünkü çapraz doğrulama (good/total = rate) ancak üçü birlikteyken yapılabilir.

Bağlantı koptuğunda okumalar diske kuyruklanır, bağlantı gelince gönderilir.
Fabrika ağı güvenilmez olabilir, veri kaybı kabul edilemez.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from pathlib import Path

LOG = logging.getLogger(__name__)


class IngestBridge:
    def __init__(self, api_url: str, machine_id: str,
                 min_interval: float = 2.0,
                 spool_path: str = "output/spool.jsonl",
                 required=("total", "good")):
        """
        api_url     : merkezi servis, ör. http://192.168.1.50:8000
        machine_id  : bu Pi'nin izlediği makine, ör. MAK-01
        min_interval: merkeze en sık kaç saniyede bir gönderilecek
        required    : bu alanlar okunmadan gönderim yapılmaz
        """
        self.url = api_url.rstrip("/") + "/ingest"
        self.machine_id = machine_id
        self.min_interval = min_interval
        self.required = set(required)

        self.values: dict[str, str] = {}
        self.scores: dict[str, float] = {}
        self.lock = threading.Lock()
        self.last_sent = 0.0

        self.spool = Path(spool_path)
        self.spool.parent.mkdir(parents=True, exist_ok=True)
        self.outbox: queue.Queue = queue.Queue(maxsize=5000)

        self.stop_event = threading.Event()
        self.sent = 0
        self.failed = 0
        self.online = False

        self._thread = threading.Thread(target=self._sender, name="ingest", daemon=True)
        self._thread.start()

    # ------------------------------------------------------------------ #

    def update(self, roi_id: str, value, confidence: float = 0.0) -> None:
        """Stabil hale gelen her ROI değeri buraya düşer."""
        with self.lock:
            self.values[roi_id] = str(value)
            self.scores[roi_id] = confidence / 100.0   # 0-1 ölçeğine geri
            now = time.time()
            if not self.required.issubset(self.values):
                return
            if now - self.last_sent < self.min_interval:
                return
            self.last_sent = now
            payload = self._build(now)

        try:
            self.outbox.put_nowait(payload)
        except queue.Full:
            LOG.warning("Ingest kuyruğu dolu, en eski kayıt düşürülüyor")
            try:
                self.outbox.get_nowait()
                self.outbox.put_nowait(payload)
            except queue.Empty:
                pass

    def _build(self, now: float) -> dict:
        v = self.values

        def as_int(key):
            s = "".join(ch for ch in v.get(key, "") if ch.isdigit())
            return int(s) if s else None

        def as_float(key):
            s = "".join(ch for ch in v.get(key, "") if ch.isdigit() or ch == ".")
            try:
                return float(s) if s else None
            except ValueError:
                return None

        import datetime as dt
        return {
            "machine_id": self.machine_id,
            "ts": dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(),
            "model": v.get("model") or None,
            "total": as_int("total"),
            "good": as_int("good"),
            "rate": as_float("rate"),
            "runtime": as_float("runtime"),
            "speed": as_int("speed"),
            "min_score": min(self.scores.values()) if self.scores else None,
            "problems": [],
        }

    # ------------------------------------------------------------------ #

    def _sender(self):
        """Kuyruğu boşaltır. Ağ yoksa diske yazar, gelince yeniden dener."""
        import urllib.error
        import urllib.request

        self._replay_spool()

        while not self.stop_event.is_set():
            try:
                payload = self.outbox.get(timeout=1.0)
            except queue.Empty:
                continue

            body = json.dumps(payload).encode()
            req = urllib.request.Request(
                self.url, data=body,
                headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp.read()
                self.sent += 1
                if not self.online:
                    LOG.info("Merkezi servise bağlanıldı: %s", self.url)
                self.online = True
            except (urllib.error.URLError, OSError) as exc:
                self.failed += 1
                if self.online:
                    LOG.warning("Merkez erişilemiyor (%s); okumalar diske alınıyor", exc)
                self.online = False
                self._spool(payload)

    def _spool(self, payload: dict) -> None:
        try:
            with self.spool.open("a", encoding="utf-8") as f:
                f.write(json.dumps(payload) + "\n")
        except Exception:
            LOG.exception("Spool yazılamadı")

    def _replay_spool(self) -> None:
        """Açılışta birikmiş kayıtları kuyruğa geri koy."""
        if not self.spool.exists():
            return
        try:
            lines = self.spool.read_text(encoding="utf-8").splitlines()
            self.spool.unlink()
        except Exception:
            LOG.exception("Spool okunamadı")
            return
        restored = 0
        for line in lines:
            if not line.strip():
                continue
            try:
                self.outbox.put_nowait(json.loads(line))
                restored += 1
            except (queue.Full, json.JSONDecodeError):
                break
        if restored:
            LOG.info("Diskten %d bekleyen okuma geri yüklendi", restored)

    # ------------------------------------------------------------------ #

    def health(self) -> dict:
        return {"ingest_online": self.online, "ingest_sent": self.sent,
                "ingest_failed": self.failed, "ingest_queued": self.outbox.qsize()}

    def stop(self) -> None:
        self.stop_event.set()
        # kalan kuyruğu diske al, veri kaybolmasın
        while True:
            try:
                self._spool(self.outbox.get_nowait())
            except queue.Empty:
                break
