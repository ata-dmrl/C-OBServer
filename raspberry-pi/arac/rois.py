"""
JWC panosundaki okunacak alanların tanımı.

Koordinatlar GERÇEK USB capture çıktısından ölçüldü:
1920x1080, MJPG, MacroSilicon MS2109.

Runtime'da oranlanıyor, yani capture farklı bir çözünürlükte gelse de
(1280x720 gibi) aynı config çalışır — pano çerçevede aynı göreli konumda
olduğu sürece.

Ölçüm notu: kareler arası piksel farkı ortalama 0.5 (sadece MJPEG
gürültüsü). Sabit ROI güvenli, hizalama gerekmiyor.
"""

REF_W, REF_H = 1920, 1080

# (x1, y1, x2, y2) — referans çözünürlükte piksel
VALUE_ROIS = {
    "model":   (1368, 196, 1858, 320),
    "total":   (1420, 352, 1857, 480),
    "good":    (1416, 512, 1853, 638),
    "rate":    (1380, 672, 1848, 796),
    "runtime": (1408, 832, 1843, 955),
    # Kadranın ortasındaki kırmızı hız değeri.
    # Rakam ortalanmış ve 3 haneye kadar çıkabiliyor (skala 0-300),
    # o yüzden ROI geniş tutuldu — dar kırparsan "250" kenarlardan kesilir.
    # Soldaki "50" etiketi ve ibre bu kutunun dışında kalıyor.
    "speed":   (325, 372, 705, 566),
}

# Alanın beklenen tipi — parse ve doğrulama bunu kullanıyor
FIELD_TYPES = {
    "model":   "text",
    "total":   "int",
    "good":    "int",
    "rate":    "percent",
    "runtime": "hours",
    "speed":   "int",
}

# Her karede okunması gereken alanlar. Diğerleri yavaş değişiyor:
# model vardiyada bir kez, runtime 6 dakikada bir, rate zaten hesaplanabiliyor.
HOT_FIELDS = ("total", "good", "speed")


def scaled_rois(width: int, height: int) -> dict[str, tuple[int, int, int, int]]:
    """ROI'leri hedef çözünürlüğe oranla."""
    sx, sy = width / REF_W, height / REF_H
    out = {}
    for name, (x1, y1, x2, y2) in VALUE_ROIS.items():
        out[name] = (
            int(round(x1 * sx)), int(round(y1 * sy)),
            int(round(x2 * sx)), int(round(y2 * sy)),
        )
    return out


def crop_fields(image):
    """BGR/RGB numpy array -> {alan_adı: kırpık}"""
    h, w = image.shape[:2]
    rois = scaled_rois(w, h)
    return {name: image[y1:y2, x1:x2] for name, (x1, y1, x2, y2) in rois.items()}
