"""
Veritabanı şeması.

DATABASE_URL ile hem SQLite hem PostgreSQL çalışır:
    dev  : sqlite:///../data/jwc.db               (paylaşılan, adapha-api ile ortak dosya)
    prod : postgresql+psycopg://user:pw@host/jwc

İki tablo var, merkezin sorumluluğunda olan kısım bu ikisi (uygulama
tarafının tabloları — uygulama_verisi/uygulama_trend/uygulama_log — aynı
dosyada ama Prisma tarafından yönetiliyor, burada tanımlı değil):

  merkez_veri   : ham okuma geçmişi. Trend grafiği ve sonradan analiz için.
                  Her okumada değil, değişimde veya periyodik yazılır.
  cihaz_durumu  : makine yapılandırması + işlenmiş olaylar tek tabloda.
                  kayit_tipi='YAPILANDIRMA' olan satır (makine başına 1 tane,
                  upsert edilir) ayarları tutar; diğer kayit_tipi değerleri
                  (DURUS, MODEL_DEGISIMI, ...) geçmiş olay satırlarıdır.
                  Duruş süresi bu tablodan gelir, merkez_veri'den hesaplanmaz.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import (Boolean, DateTime, Float, Index, Integer,
                        String, JSON, create_engine, event, func, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///jwc.db")

engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmalari(dbapi_baglanti, _kayit):
        """WAL modu (journal_mode) veritabanı dosyasında kalıcıdır, ama
        busy_timeout ve wal_autocheckpoint BAĞLANTI BAZLIDIR — her yeni
        bağlantıda yeniden ayarlanmalı. adapha-api (Node) kendi tarafında
        aynısını yapıyor (bkz. lib/prisma.ts) — ikisi de wal_autocheckpoint'i
        kapatıp günde bir kez elle checkpoint alıyor (bkz. api.py lifespan).
        """
        imlec = dbapi_baglanti.cursor()
        imlec.execute("PRAGMA busy_timeout=5000")
        imlec.execute("PRAGMA wal_autocheckpoint=0")
        imlec.close()

KAYIT_TIPI_YAPILANDIRMA = "YAPILANDIRMA"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class MerkezVeri(Base):
    __tablename__ = "merkez_veri"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    good: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    runtime_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # düşük güvenli okumaları sonradan incelemek için
    min_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    valid: Mapped[bool] = mapped_column(Boolean, default=True)


class CihazDurumu(Base):
    __tablename__ = "cihaz_durumu"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(String(32), index=True)
    # "YAPILANDIRMA" (makine başına 1 satır) veya bir EventType değeri
    # (DURUS, MODEL_DEGISIMI, SAYAC_RESET, KALITE_UYARISI, SINYAL_KAYBI)
    kayit_tipi: Mapped[str] = mapped_column(String(32), index=True)

    # --- kayit_tipi == YAPILANDIRMA satırında dolu, olay satırlarında NULL ---
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # default'lar eski Machine modeliyle aynı — yeni bir makine ilk kez veri
    # gönderdiğinde (ensure_machine) bu değerler olmadan satır oluşuyordu,
    # quality_min NULL kalınca _check_quality'de "float < None" ile çöküyordu.
    # 300 sn (5 dk) çok yüksekti: test/simülasyon akışındaki ~90 sn'lik
    # duruşlar hiç eşiği aşmıyor, bu yüzden bazı makineler hiç pasife
    # geçmiyor, bildirim gelmiyor, duruş süresi hep 0 kalıyordu. Test/geliştirme
    # sürecinde hızlı geri bildirim için 5 sn'ye çekildi.
    stall_seconds: Mapped[float | None] = mapped_column(Float, nullable=True, default=5.0)
    nominal_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_min: Mapped[float | None] = mapped_column(Float, nullable=True, default=95.0)
    active: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # --- kayit_tipi != YAPILANDIRMA (olay) satırlarında dolu ---
    start_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


# Panelin en sık sorgusu: "şu makinenin şu aralıktaki olayları"
Index("ix_cihaz_durumu_machine_start", CihazDurumu.machine_id, CihazDurumu.start_ts)
Index("ix_cihaz_durumu_machine_tipi", CihazDurumu.machine_id, CihazDurumu.kayit_tipi)
Index("ix_merkez_veri_machine_ts", MerkezVeri.machine_id, MerkezVeri.ts)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_config_row(session, machine_id: str) -> CihazDurumu | None:
    return session.query(CihazDurumu).filter_by(
        machine_id=machine_id, kayit_tipi=KAYIT_TIPI_YAPILANDIRMA
    ).one_or_none()


def ensure_machine(session, machine_id: str, **kw) -> CihazDurumu:
    m = get_config_row(session, machine_id)
    if m is None:
        m = CihazDurumu(
            machine_id=machine_id, kayit_tipi=KAYIT_TIPI_YAPILANDIRMA,
            name=kw.pop("name", machine_id), active=True, **kw,
        )
        session.add(m)
        session.commit()
    return m
