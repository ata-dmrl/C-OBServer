"""
RapidOCR tabanlı tanıma motoru — OCREngine'in yerine geçer.

Sözleşme birebir aynı:
    recognize(image, cfg) -> OCRResult(value, raw_value, confidence, valid)
    close()

Bu yüzden main.py'de tek satır değişiyor, hattın geri kalanına dokunulmuyor.
Capture, tee/passthrough, dispatcher, değişim tespiti ve Stabilizer aynen kalır.

Neden Tesseract yerine bu:
  - Ölçüm: bu donanımda alan başına ~272 ms, Tesseract'ın 2 worker'a
    sıkıştırılmasını gerektiren maliyeti yok.
  - PP-OCRv6 dijital gösterge ve endüstriyel karakterler için eğitilmiş.
  - Tesseract'ın psm/whitelist ayarlarına ihtiyaç duymuyor; whitelist yine de
    çıktı filtresi olarak uygulanıyor (aşağıya bakın).

Kurulum:
    pip install rapidocr==3.9.1 onnxruntime
"""

from __future__ import annotations

import logging
import threading

import numpy as np

from .config import ROIConfig
from .ocr_engine import OCRResult, normalize_text

LOG = logging.getLogger(__name__)


class RapidEngine:
    """Worker başına bir örnek. RapidOCR nesnesi thread'ler arası paylaşılmaz."""

    def __init__(self, default_language: str = "eng",
                 model_type: str = "small", threads: int = 1):
        from rapidocr import EngineType, LangRec, ModelType, OCRVersion, RapidOCR

        self.default_language = default_language
        self._owner = threading.get_ident()
        self.backend = f"rapidocr[{model_type}]"

        tiers = {"tiny": ModelType.TINY, "small": ModelType.SMALL,
                 "medium": ModelType.MEDIUM}

        self.engine = RapidOCR(params={
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.EN,
            "Rec.ocr_version": OCRVersion.PPOCRV6,
            "Rec.model_type": tiers[model_type],
            "Global.text_score": 0.5,
            "EngineConfig.onnxruntime.use_cuda": False,
            # Birden fazla worker paralel çalışacaksa şart: yoksa her worker
            # tüm çekirdekleri istemeye kalkar ve toplam yavaşlar.
            "EngineConfig.onnxruntime.intra_op_num_threads": threads,
        })

    def recognize(self, image: np.ndarray, cfg: ROIConfig) -> OCRResult:
        if threading.get_ident() != self._owner:
            raise RuntimeError("RapidEngine must only be used by its owning worker")

        # preprocess() tek kanallı görüntü döndürebiliyor; RapidOCR 3 kanal bekler.
        if image.ndim == 2:
            image = np.stack([image] * 3, axis=-1)

        # use_det=False kritik ve burada güvenli: ROI zaten tek satırlık bir
        # alan, yani tanıma modelinin eğitildiği girdi formatı. Detection
        # maliyetin büyük kısmı ve bu senaryoda hiçbir katkısı yok.
        try:
            res = self.engine(image, use_det=False, use_cls=False)
        except Exception:
            LOG.exception("RapidOCR failed for ROI %s", cfg.id)
            return OCRResult("", "", 0.0, False)

        txts = getattr(res, "txts", None) or []
        scores = getattr(res, "scores", None) or []
        raw = str(txts[0]) if txts else ""
        # Tesseract 0-100 ölçeğinde güven veriyor; cfg.min_confidence ona göre
        # ayarlı. RapidOCR 0-1 veriyor, aynı ölçeğe çeviriyoruz.
        confidence = float(scores[0]) * 100 if scores else 0.0

        value = normalize_text(raw)

        # whitelist Tesseract'a özgü bir ayar ama çıktı filtresi olarak
        # burada da işe yarıyor: modelin ürettiği beklenmedik karakterleri atar.
        if cfg.whitelist:
            allowed = set(cfg.whitelist)
            value = "".join(ch for ch in value if ch in allowed)

        valid = confidence >= cfg.min_confidence and bool(value)
        if valid and cfg.regex:
            import re
            valid = re.fullmatch(cfg.regex, value) is not None

        return OCRResult(value, raw, confidence, valid)

    def close(self):
        self.engine = None


def prepare_rapid_backend() -> str:
    """main.py'deki prepare_ocr_backend() karşılığı.

    RapidOCR'ın ana thread'de önden yüklenmesi gerekmiyor (tesserocr'daki
    cysignals kısıtı yok), ama modellerin ilk indirilmesini servis başlarken
    yapmak sahada iyi olur.
    """
    import rapidocr  # noqa: F401
    return "rapidocr"
