"""
Ham OCR metnini tipli değere çevirme + alanlar arası doğrulama.

Bu katman hangi motorun okuduğundan bağımsız. Asıl güvenilirlik
buradan geliyor, motordan değil.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Reading:
    model: str | None = None
    total: int | None = None
    good: int | None = None
    rate: float | None = None
    runtime: float | None = None
    speed: int | None = None
    raw: dict = field(default_factory=dict)
    scores: dict = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems and None not in (self.total, self.good)


def _digits(s: str) -> str:
    """OCR'ın rakamlarla karıştırdığı harfleri düzelt, sonra rakam dışını at."""
    fixes = {"O": "0", "o": "0", "Q": "0", "D": "0",
             "I": "1", "l": "1", "|": "1",
             "S": "5", "s": "5", "B": "8", "G": "6", "Z": "2"}
    s = "".join(fixes.get(c, c) for c in s)
    return re.sub(r"[^\d]", "", s)


def parse(raw: dict[str, str], scores: dict[str, float]) -> Reading:
    r = Reading(raw=dict(raw), scores=dict(scores))

    model = raw.get("model", "").strip()
    r.model = model if model else None

    for key in ("total", "good"):
        d = _digits(raw.get(key, ""))
        if d:
            setattr(r, key, int(d))
        else:
            r.problems.append(f"{key}: rakam çıkmadı ({raw.get(key)!r})")

    m = re.search(r"(\d+[.,]?\d*)", raw.get("rate", "").replace("O", "0"))
    if m:
        r.rate = float(m.group(1).replace(",", "."))

    m = re.search(r"(\d+[.,]?\d*)", raw.get("runtime", "").replace("O", "0"))
    if m:
        r.runtime = float(m.group(1).replace(",", "."))

    if "speed" in raw:
        d = _digits(raw.get("speed", ""))
        # Boş okuma burada normal değil: hız 0 olsa bile ekranda "0" yazıyor.
        if d:
            r.speed = int(d)
        else:
            r.problems.append(f"speed: rakam çıkmadı ({raw.get('speed')!r})")

    _validate(r)
    return r


def _validate(r: Reading) -> None:
    """Alanlar arası tutarlılık. Tek başına doğru görünen okumaları yakalar."""

    if r.total is not None and r.good is not None:
        if r.good > r.total:
            r.problems.append(f"good({r.good}) > total({r.total})")

        # Ekrandaki Rate ile hesaplanan oran uyuşmalı.
        # Bu, ücretsiz bir checksum: üç alandan biri yanlış okunduysa tutmaz.
        if r.rate is not None and r.total > 0:
            calc = r.good / r.total * 100
            if abs(calc - r.rate) > 0.05:
                r.problems.append(
                    f"rate uyuşmuyor: ekran={r.rate:.2f} hesap={calc:.2f}"
                )

    if r.rate is not None and not (0 <= r.rate <= 100):
        r.problems.append(f"rate aralık dışı: {r.rate}")

    if r.runtime is not None and not (0 <= r.runtime <= 24 * 30):
        r.problems.append(f"runtime aralık dışı: {r.runtime}")

    # Kadran skalası 0-300. Dışına çıkan okuma kesinlikle hatalı.
    if r.speed is not None and not (0 <= r.speed <= 300):
        r.problems.append(f"speed skala dışı: {r.speed}")

    for key, sc in r.scores.items():
        if sc < 0.7:
            r.problems.append(f"{key}: düşük güven ({sc:.2f})")


def check_monotonic(prev: Reading | None, cur: Reading) -> str | None:
    """Ardışık okumalar arası kural. Sayaç geri gitmez."""
    if prev is None or prev.total is None or cur.total is None:
        return None
    if cur.total < prev.total:
        if cur.total < prev.total * 0.5:
            return "SAYAC_RESET"
        return "OKUMA_HATASI"
    return None
