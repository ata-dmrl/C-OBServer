"""
Okumaları olaya çeviren durum makinesi.

Sistemin ürünü "ekrandaki sayı" değil, "şu makinede şu saatte şu oldu"
kaydıdır. Bu dosya o dönüşümü yapar.

Tasarım notu — duruşun başlangıç zamanı:
    Sayacın durduğunu ancak eşik kadar bekledikten sonra anlayabiliyoruz.
    Ama duruş, bizim fark ettiğimiz anda değil, sayacın son arttığı anda
    başlamıştır. Bu yüzden olayın başlangıcı geriye dönük yazılır.
    Aksi halde her duruşu eşik süresi kadar kısa raporlarız.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class Status(str, Enum):
    UNKNOWN = "BILINMIYOR"
    RUNNING = "CALISIYOR"
    STOPPED = "DURDU"
    NO_SIGNAL = "SINYAL_YOK"


class EventType(str, Enum):
    DOWNTIME = "DURUS"
    MODEL_CHANGE = "MODEL_DEGISIMI"
    COUNTER_RESET = "SAYAC_RESET"
    QUALITY_ALERT = "KALITE_UYARISI"
    SIGNAL_LOST = "SINYAL_KAYBI"


@dataclass
class Event:
    machine_id: str
    type: EventType
    start_ts: float
    end_ts: float | None = None
    meta: dict = field(default_factory=dict)

    @property
    def duration(self) -> float | None:
        return None if self.end_ts is None else self.end_ts - self.start_ts

    @property
    def open(self) -> bool:
        return self.end_ts is None

    def __str__(self) -> str:
        t = time.strftime("%H:%M:%S", time.localtime(self.start_ts))
        d = f" ({self.duration:.0f}s)" if self.duration is not None else " [açık]"
        extra = " ".join(f"{k}={v}" for k, v in self.meta.items())
        return f"[{t}] {self.machine_id} {self.type.value}{d} {extra}".rstrip()


@dataclass
class MachineConfig:
    machine_id: str

    # Sayaç bu kadar saniye artmazsa duruş sayılır.
    # Makinenin normal çevrim süresine göre ayarlanmalı: 3 saniyede bir
    # üretim yapan makinede 30 sn duruştur, yavaş makinede normaldir.
    # Test videosunda OCR'ın total/good'u tazelemesi zaman zaman 30 sn'yi
    # aşabiliyor (döngü sınırında); gerçek donanımda tekrar 30'a indirilmeli.
    stall_seconds: float = 60.0

    # Nominal hız (adet/saat). OEE'nin Performance bileşeni için.
    nominal_rate: float | None = None

    # Kalite bu eşiğin altına düşerse uyarı. Histerezis ile geri döner.
    quality_min: float = 95.0
    quality_recover: float = 96.0

    # Arka arkaya bu kadar geçersiz okuma gelirse sinyal kaybı.
    max_bad_readings: int = 5


class MachineEngine:
    """Tek makinenin durumunu tutar. Her makine için bir örnek."""

    def __init__(self, cfg: MachineConfig):
        self.cfg = cfg
        self.status = Status.UNKNOWN

        self.last_total: int | None = None
        self.last_good: int | None = None
        self.last_model: str | None = None
        self.last_rate: float | None = None           # makinenin kendi bildirdiği kalite oranı
        self.last_progress_ts: float | None = None   # sayacın son arttığı an

        self.bad_streak = 0
        self.open_events: dict[EventType, Event] = {}

        # vardiya/oturum sayaçları
        self.session_start: float | None = None
        self.produced = 0
        self.produced_good = 0
        self.downtime_total = 0.0

    # ------------------------------------------------------------------ #

    def update(self, reading, ts: float | None = None) -> list[Event]:
        """Bir okumayı işle, ortaya çıkan olayları döndür."""
        ts = time.time() if ts is None else ts
        out: list[Event] = []

        if reading is None or not reading.ok:
            out += self._on_bad_reading(ts)
            return out

        self.bad_streak = 0
        out += self._close(EventType.SIGNAL_LOST, ts)
        if self.session_start is None:
            self.session_start = ts

        out += self._check_model(reading, ts)
        out += self._check_counter(reading, ts)
        out += self._check_quality(reading, ts)

        self.last_total = reading.total
        self.last_good = reading.good
        if reading.rate is not None:
            self.last_rate = reading.rate
        return out

    # ------------------------------------------------------------------ #

    def _on_bad_reading(self, ts: float) -> list[Event]:
        self.bad_streak += 1
        if self.bad_streak < self.cfg.max_bad_readings:
            return []
        if self.status is Status.NO_SIGNAL:
            return []
        self.status = Status.NO_SIGNAL
        return [self._open(EventType.SIGNAL_LOST, ts,
                           {"ardisik_hatali": self.bad_streak})]

    def _new_session(self, ts: float) -> list[Event]:
        """Oturumu sıfırla.

        Kritik: açık duruş varsa ÖNCE kapatılmalı ve birikmiş duruş toplamı
        temizlenmeli. Aksi halde eski oturumun duruşu yeni oturuma yazılır ve
        downtime > planned_time gibi imkansız bir sonuç çıkar.
        """
        out = self._close(EventType.DOWNTIME, ts)
        self.session_start = ts
        self.produced = self.produced_good = 0
        self.downtime_total = 0.0
        self.last_progress_ts = ts
        self.status = Status.RUNNING
        return out

    def _check_model(self, reading, ts: float) -> list[Event]:
        new = reading.model
        if not new or new == self.last_model:
            return []

        if self.last_model is None:
            # İlk okuma: karşılaştıracak bir şey yok, olay üretmeden kabul et.
            self.last_model = new
            return []

        # Model üretim sırasında değişebiliyor ve bu anlık yansımalı —
        # tek okumada kabul ediyoruz. Yanlış OCR okumasına karşı asıl
        # savunma Pi'deki OCR stabilizer'ı (main.py); burada ekstra
        # gecikme eklemek "anlık güncelleme" beklentisiyle çelişiyordu.
        #
        # Not: model değişimi artık oturumu SIFIRLAMIYOR. Model, üretim
        # sırasında sık sık değişebiliyor (bu test videosunda birkaç
        # dakikada bir); her değişimde duruş/OEE takibini sıfırlamak,
        # duruş süresinin hiçbir zaman birikememesine sebep oluyordu.
        # Olay yine de kaydediliyor, sadece oturumu etkilemiyor.
        eski = self.last_model
        self.last_model = new
        ev = Event(self.cfg.machine_id, EventType.MODEL_CHANGE, ts, ts,
                   {"eski": eski, "yeni": new})
        return [ev]

    def _check_counter(self, reading, ts: float) -> list[Event]:
        total = reading.total
        out: list[Event] = []

        if self.last_total is None:
            self.last_progress_ts = ts
            self.status = Status.RUNNING
            return out

        if total < self.last_total:
            # Ciddi düşüş reset, küçük düşüş okuma hatası (parsing yakalamadıysa)
            if total < self.last_total * 0.5:
                out.append(Event(self.cfg.machine_id, EventType.COUNTER_RESET,
                                 ts, ts, {"eski": self.last_total, "yeni": total}))
                out += self._new_session(ts)
            return out

        if total > self.last_total:
            delta = total - self.last_total
            # Video döngüsü, ekran değişimi veya hatalı okuma sonrası sayaç
            # bir anda sıçrayabiliyor. Nominal hızın çok üstündeki artışı
            # üretim olarak saymak OEE'yi bozar; olayı yine de ilerlet ama
            # üretim toplamına ekleme.
            gap = max(1e-6, ts - (self.last_progress_ts or ts))
            plausible = (self.cfg.nominal_rate or 100000) / 3600 * gap * 5 + 50
            if delta > plausible:
                out.append(Event(self.cfg.machine_id, EventType.COUNTER_RESET,
                                 ts, ts, {"eski": self.last_total, "yeni": total,
                                          "not": "olagandisi sicrama"}))
                out += self._new_session(ts)
                return out
            self.produced += delta
            if reading.good is not None and self.last_good is not None:
                self.produced_good += max(0, min(delta, reading.good - self.last_good))
            self.last_progress_ts = ts
            if self.status is not Status.RUNNING:
                out += self._close(EventType.DOWNTIME, ts)
                self.status = Status.RUNNING
            return out

        # total == last_total  -> sayaç duruyor
        stalled = ts - (self.last_progress_ts or ts)
        if stalled >= self.cfg.stall_seconds and self.status is not Status.STOPPED:
            self.status = Status.STOPPED
            # başlangıç: fark ettiğimiz an değil, sayacın son arttığı an
            out.append(self._open(EventType.DOWNTIME, self.last_progress_ts or ts,
                                  {"esik_sn": self.cfg.stall_seconds}))
        return out

    # Not: bir ara anlık hız (speed) üstünden ayrıca, daha hızlı tepki veren
    # bir duruş tespiti (_check_speed) denendi. Analog gösterge okuması
    # gürültülü çıktığında pasif<->aktif arasında döngüye girip bildirim
    # spam'ine ve OEE/kullanılabilirliğin aniden 0'a düşmesine sebep oldu.
    # Duruş tespiti tamamen sayaca (total) dayanıyor artık — daha yavaş ama
    # güvenilir; sayaç gerçekten ilerlemediği sürece yanlış pozitif vermez.

    def _check_quality(self, reading, ts: float) -> list[Event]:
        if reading.rate is None:
            return []
        alert = self.open_events.get(EventType.QUALITY_ALERT)
        if alert is None and reading.rate < self.cfg.quality_min:
            return [self._open(EventType.QUALITY_ALERT, ts, {"oran": reading.rate})]
        if alert is not None and reading.rate >= self.cfg.quality_recover:
            return self._close(EventType.QUALITY_ALERT, ts)
        return []

    # ------------------------------------------------------------------ #

    def _open(self, kind: EventType, ts: float, meta: dict) -> Event:
        ev = Event(self.cfg.machine_id, kind, ts, None, meta)
        self.open_events[kind] = ev
        return ev

    def _close(self, kind: EventType, ts: float) -> list[Event]:
        ev = self.open_events.pop(kind, None)
        if ev is None:
            return []
        ev.end_ts = ts
        if kind is EventType.DOWNTIME:
            self.downtime_total += ev.duration or 0.0
        return [ev]

    # ------------------------------------------------------------------ #

    def oee(self, now: float | None = None) -> dict:
        """
        OEE = Availability x Performance x Quality

        Üçü de eldeki üç alandan hesaplanıyor, ekstra veri gerekmiyor.
        Performance için makinenin nominal hızı configte tanımlı olmalı.
        """
        now = time.time() if now is None else now
        if self.session_start is None:
            return {}

        planned = now - self.session_start
        if planned <= 0:
            return {}

        # açık duruş varsa onu da say
        downtime = self.downtime_total
        open_dt = self.open_events.get(EventType.DOWNTIME)
        if open_dt is not None:
            downtime += now - open_dt.start_ts

        run_time = max(0.0, planned - downtime)

        # Kullanılabilirlik = toplam üretimin iyi üretime oranı (ham,
        # ömür boyu sayaçlar - last_total/last_good, ekrandaki "toplam
        # üretim"/"iyi üretim" ile aynı alanlar). Klasik OEE'de Availability
        # run_time/planned_time'dır ama bu sistemde iş tanımı böyle istendi.
        availability = (self.last_good or 0) / self.last_total if self.last_total else 0.0

        # Makinenin kendi bildirdiği kalite oranını tercih ediyoruz.
        # produced_good/produced türetimi, total ile good alanları farklı
        # anlarda güncellendiği için (özellikle sayaç sıfırlanma sınırında)
        # geçici olarak yanlış (ör. %0) çıkabiliyordu.
        if self.last_rate is not None:
            quality = self.last_rate / 100.0
        else:
            quality = (self.produced_good / self.produced) if self.produced else 1.0

        performance = None
        if self.cfg.nominal_rate and run_time > 0:
            expected = self.cfg.nominal_rate * (run_time / 3600)
            performance = min(1.0, self.produced / expected) if expected else None

        result = {
            "availability": availability,
            "quality": quality,
            "performance": performance,
            "planned_s": planned,
            "downtime_s": downtime,
            "uretim": self.produced,
            "uretim_iyi": self.produced_good,
        }
        # nominal_rate tanımsızsa performance yok — o durumda iki bileşenli
        # (Availability x Quality) OEE hesapla; boş bırakmak yerine.
        # nominal_rate configte tanımlanınca otomatik üç bileşenliye döner.
        effective_performance = performance if performance is not None else 1.0
        result["oee"] = availability * effective_performance * quality
        return result
