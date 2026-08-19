"""
İki OCR motoru, tek arayüz.

Her reader şu sözleşmeyi uygular:

    read(crop) -> (text: str, score: float, ms: float)

Böylece sistemin geri kalanı hangi motorun çalıştığını bilmez.
Kazanan belli olunca kaybeden dosya silinir, başka hiçbir yer değişmez.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod

import numpy as np


class BaseReader(ABC):
    name = "base"

    @abstractmethod
    def _infer(self, crop: np.ndarray) -> tuple[str, float]:
        ...

    def read(self, crop: np.ndarray) -> tuple[str, float, float]:
        t0 = time.perf_counter()
        text, score = self._infer(crop)
        return text, score, (time.perf_counter() - t0) * 1000

    def warmup(self, crop: np.ndarray, n: int = 3) -> None:
        """İlk çağrılar her zaman yavaş. Ölçümden önce motoru ısıt."""
        for _ in range(n):
            self._infer(crop)


class RapidReader(BaseReader):
    """
    rapidocr==3.9.1 + onnxruntime

    use_det=False kritik: ROI zaten tek satırlık bir alan, yani modelin
    eğitildiği girdi formatı. Detection aşaması maliyetin büyük kısmı ve
    burada hiçbir katkısı yok.
    """

    name = "rapidocr"

    def __init__(self, model_type: str = "medium"):
        from rapidocr import RapidOCR, EngineType, LangRec, ModelType, OCRVersion

        tiers = {
            "tiny": ModelType.TINY,
            "small": ModelType.SMALL,
            "medium": ModelType.MEDIUM,
        }
        self.name = f"rapidocr[{model_type}]"
        self.engine = RapidOCR(params={
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.EN,
            "Rec.ocr_version": OCRVersion.PPOCRV6,
            "Rec.model_type": tiers[model_type],
            "Global.text_score": 0.5,
            "EngineConfig.onnxruntime.use_cuda": False,
        })

    def _infer(self, crop):
        res = self.engine(crop, use_det=False, use_cls=False)
        txts = getattr(res, "txts", None)
        scores = getattr(res, "scores", None)
        if not txts:
            return "", 0.0
        return str(txts[0]).strip(), float(scores[0]) if scores else 0.0


class PaddleReader(BaseReader):
    """
    paddleocr (3.7+) — sadece tanıma modülü.

    PaddleOCR() sınıfı tüm pipeline'ı (detection + yön + tanıma) çalıştırır.
    ROI verirken bunların hiçbiri gerekmiyor, o yüzden TextRecognition
    modülünü doğrudan kullanıyoruz.

    NOT: model_name'i kurulu sürüme göre doğrula:
        python -c "from paddleocr import TextRecognition; help(TextRecognition)"
    """

    name = "paddleocr"

    def __init__(self, model_name: str = "PP-OCRv5_server_rec"):
        from paddleocr import TextRecognition

        self.name = f"paddleocr[{model_name}]"
        self.model = TextRecognition(model_name=model_name)

    def _infer(self, crop):
        out = self.model.predict(crop)
        if not out:
            return "", 0.0
        r = out[0]
        return str(r.get("rec_text", "")).strip(), float(r.get("rec_score", 0.0))


class TemplateReader(BaseReader):
    """
    Referans yöntem: sabit fontta rakam eşleme.

    Şablonlar bir kez çıkarılıp diske yazılır (bkz. make_templates.py).
    Buradaki amaç OCR'ı yenmek değil, "ne kadar hızlı olabilirdi"
    sorusuna sayı vermek.
    """

    name = "template"

    def __init__(self, template_dir: str = "templates"):
        import pathlib
        import cv2

        self.cv2 = cv2
        self.templates = {}
        for p in sorted(pathlib.Path(template_dir).glob("*.png")):
            self.templates[p.stem] = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if not self.templates:
            raise RuntimeError(f"{template_dir} içinde şablon yok")

    def _infer(self, crop):
        cv2 = self.cv2
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # bağlı bileşenler = karakter adayları, soldan sağa sırala
        n, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
        boxes = [
            (stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP],
             stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
            for i in range(1, n)
            if stats[i, cv2.CC_STAT_HEIGHT] > binary.shape[0] * 0.35
        ]
        boxes.sort(key=lambda b: b[0])

        text, scores = "", []
        for x, y, w, h in boxes:
            char_img = binary[y:y + h, x:x + w]
            best_ch, best_score = "?", -1.0
            for ch, tmpl in self.templates.items():
                resized = cv2.resize(char_img, (tmpl.shape[1], tmpl.shape[0]))
                score = cv2.matchTemplate(resized, tmpl, cv2.TM_CCOEFF_NORMED).max()
                if score > best_score:
                    best_ch, best_score = ch, float(score)
            text += best_ch
            scores.append(best_score)

        return text, (sum(scores) / len(scores) if scores else 0.0)
