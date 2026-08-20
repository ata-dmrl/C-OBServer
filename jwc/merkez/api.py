#!/usr/bin/env python3
"""
Backend servisi.

    uvicorn api:app --reload --host 0.0.0.0 --port 8000

Dokümantasyon: http://localhost:8000/docs

Mimarideki yeri: worker'lar okumaları POST /ingest ile buraya gönderir.
Olay motoru burada, bellekte çalışır; ürettiği olaylar veritabanına yazılır
ve aynı anda WebSocket'ten canlı yayınlanır. Panel ve mobil polling yapmaz.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, text

import db as D
from events import MachineConfig, MachineEngine, Status
from parsing import Reading

# --------------------------------------------------------------------------- #
# bellekteki durum

ENGINES: dict[str, MachineEngine] = {}


def machine_id_ip_ile(s, ip: str) -> str | None:
    """Admin panelinden (uygulama tarafı, UygulamaVerisi tablosu) bu IP'ye
    atanmış makineyi bulur — TERS sorgu (IP -> machine_id). Aynı paylaşılan
    dosyada ama Prisma'nın yönettiği bir tablo olduğu için ham SQL ile
    okuyoruz, SQLAlchemy modeli yok.

    Admin panelinde bir IP'yi bir makineye atamak, o IP'den gelen veriyi
    ARTIK O MAKİNE sayar — Pi'nin kendi gönderdiği machine_id'den bağımsız.
    Böylece bir Pi fiziksel olarak başka bir hatta taşındığında, Pi'nin
    kendi ayarına (JWC_MACHINE_ID) dokunmadan, sadece admin panelinden IP'yi
    yeni makineye atayarak veri akışı otomatik oraya yönlenir.
    """
    row = s.execute(
        text('SELECT id FROM "UygulamaVerisi" WHERE "piIp" = :ip'),
        {"ip": ip},
    ).first()
    return row[0] if row else None


def get_engine(machine_id: str) -> MachineEngine:
    eng = ENGINES.get(machine_id)
    if eng is None:
        with D.SessionLocal() as s:
            m = D.ensure_machine(s, machine_id)
            cfg = MachineConfig(machine_id=m.machine_id, stall_seconds=m.stall_seconds,
                                nominal_rate=m.nominal_rate, quality_min=m.quality_min)
        eng = MachineEngine(cfg)
        ENGINES[machine_id] = eng
    return eng


class Hub:
    """WebSocket abonelerine yayın yapar."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def join(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self.lock:
            self.clients.add(ws)

    async def leave(self, ws: WebSocket) -> None:
        async with self.lock:
            self.clients.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        dead = []
        async with self.lock:
            targets = list(self.clients)
        for ws in targets:
            try:
                await ws.send_text(json.dumps(payload, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.leave(ws)


hub = Hub()


async def _gunluk_wal_checkpoint():
    """wal_autocheckpoint kapalı (bkz. db.py) — WAL dosyasının jwc.db'ye
    birleşmesi artık otomatik değil, günde bir kez burada elle tetikleniyor.
    PASSIVE mod süren okuma/yazmayı bloklamaz."""
    while True:
        await asyncio.sleep(24 * 60 * 60)
        try:
            with D.SessionLocal() as s:
                s.execute(text("PRAGMA wal_checkpoint(PASSIVE);"))
                s.commit()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    D.init_db()
    checkpoint_task = asyncio.create_task(_gunluk_wal_checkpoint())
    yield
    checkpoint_task.cancel()


app = FastAPI(title="JWC Hat İzleme", version="0.1.0", lifespan=lifespan)

# Panel tarayıcıdan açıldığı için gerekli. Fabrika iç ağında çalışacağı
# varsayımıyla şimdilik açık; kimlik doğrulama eklendiğinde daraltılacak.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# şemalar

class IngestIn(BaseModel):
    machine_id: str
    ts: datetime | None = None
    model: str | None = None
    total: int | None = None
    good: int | None = None
    rate: float | None = None
    runtime: float | None = None
    speed: int | None = None
    min_score: float | None = None
    problems: list[str] = Field(default_factory=list)


class MachineOut(BaseModel):
    id: str
    name: str
    status: str
    model: str | None = None
    total: int | None = None
    good: int | None = None
    rate: float | None = None
    speed: int | None = None
    last_seen: datetime | None = None
    oee: dict | None = None


# --------------------------------------------------------------------------- #

def session():
    with D.SessionLocal() as s:
        yield s


@app.post("/ingest")
async def ingest(payload: IngestIn, request: Request, s=Depends(session)):
    """Worker'ın okuma gönderdiği uç. Sistemdeki tek yazma kapısı.

    Kimlik SADECE admin panelindeki IP ataması belirliyor: bu isteğin
    geldiği IP admin panelinde bir makineye atanmışsa, veri Pi'nin kendi
    bildirdiği machine_id'den BAĞIMSIZ olarak o makineye yazılır. Böylece
    bir Pi fiziksel olarak başka bir hatta taşınınca, Pi'ye hiç dokunmadan
    (JWC_MACHINE_ID değiştirmeden) sadece admin panelinden IP'yi yeni
    makineye atamak yeterli.

    Bu IP hiçbir makineye atanmamışsa istek REDDEDİLİR — Pi'nin kendi
    bildirdiği machine_id'ye güvenilmiyor. Eskiden burada payload.machine_id'ye
    düşülüyordu; bu, admin panelinden bir IP başka bir makineye taşınırken
    (eski atama temizlenip yenisi yazılana kadarki kısa aralıkta) Pi'nin
    orijinal/varsayılan machine_id'sinin (ör. Pi'nin fabrika ayarındaki
    MAK-01) o birkaç saniyelik pencerede veri almasına ve panelde "takılı"
    görünmesine sebep oluyordu.
    """
    kaynak_ip = request.client.host if request.client else None
    machine_id = machine_id_ip_ile(s, kaynak_ip) if kaynak_ip else None
    if machine_id is None:
        raise HTTPException(404, f"Bu IP ({kaynak_ip}) admin panelinden hiçbir makineye atanmamış.")

    ts = payload.ts or D.utcnow()
    eng = get_engine(machine_id)
    D.ensure_machine(s, machine_id)

    r = Reading(model=payload.model, total=payload.total, good=payload.good,
                rate=payload.rate, runtime=payload.runtime, speed=payload.speed,
                problems=list(payload.problems))

    new_events = eng.update(r if r.ok else None, ts.timestamp())

    s.add(D.MerkezVeri(machine_id=machine_id, ts=ts, model=payload.model,
                       total=payload.total, good=payload.good, rate=payload.rate,
                       runtime_h=payload.runtime, speed=payload.speed,
                       min_score=payload.min_score, valid=r.ok))

    emitted = []
    for ev in new_events:
        start = datetime.fromtimestamp(ev.start_ts, timezone.utc)
        end = datetime.fromtimestamp(ev.end_ts, timezone.utc) if ev.end_ts else None
        row = s.query(D.CihazDurumu).filter(
            D.CihazDurumu.machine_id == ev.machine_id,
            D.CihazDurumu.kayit_tipi == ev.type.value,
            D.CihazDurumu.start_ts == start,
        ).one_or_none()
        if row is None:
            row = D.CihazDurumu(machine_id=ev.machine_id, kayit_tipi=ev.type.value,
                                start_ts=start, meta_json=ev.meta)
            s.add(row)
        row.end_ts = end
        row.duration_s = ev.duration
        emitted.append({"type": ev.type.value, "start": start, "end": end,
                        "duration_s": ev.duration, "meta": ev.meta})
    s.commit()

    await hub.broadcast({
        "kind": "update",
        "machine_id": machine_id,
        "status": eng.status.value,
        "model": payload.model,
        "total": payload.total, "good": payload.good,
        "rate": payload.rate, "speed": payload.speed,
        "runtime": payload.runtime,
        "oee": eng.oee(),
        "events": emitted,
    })
    return {"ok": True, "status": eng.status.value, "events": len(emitted)}


@app.get("/machines", response_model=list[MachineOut])
def machines(s=Depends(session)):
    """Canlı duvar bu uçtan besleniyor."""
    out = []
    configs = s.scalars(
        select(D.CihazDurumu).where(
            D.CihazDurumu.kayit_tipi == D.KAYIT_TIPI_YAPILANDIRMA,
            D.CihazDurumu.active == True,
        )
    ).all()
    for m in configs:
        last = s.scalars(
            select(D.MerkezVeri).where(D.MerkezVeri.machine_id == m.machine_id)
            .order_by(D.MerkezVeri.ts.desc()).limit(1)
        ).first()
        eng = ENGINES.get(m.machine_id)
        out.append(MachineOut(
            id=m.machine_id, name=m.name,
            status=(eng.status.value if eng else Status.UNKNOWN.value),
            model=last.model if last else None,
            total=last.total if last else None,
            good=last.good if last else None,
            rate=last.rate if last else None,
            speed=last.speed if last else None,
            last_seen=last.ts if last else None,
            oee=(eng.oee() if eng else None),
        ))
    return out


@app.get("/machines/{machine_id}/events")
def machine_events(machine_id: str, hours: int = Query(24, ge=1, le=24 * 30),
                   s=Depends(session)):
    since = D.utcnow() - timedelta(hours=hours)
    rows = s.scalars(
        select(D.CihazDurumu)
        .where(D.CihazDurumu.machine_id == machine_id,
               D.CihazDurumu.kayit_tipi != D.KAYIT_TIPI_YAPILANDIRMA,
               D.CihazDurumu.start_ts >= since)
        .order_by(D.CihazDurumu.start_ts.desc())
    ).all()
    return [{"type": r.kayit_tipi, "start": r.start_ts, "end": r.end_ts,
             "duration_s": r.duration_s, "meta": r.meta_json} for r in rows]


@app.get("/machines/{machine_id}/samples")
def machine_samples(machine_id: str, hours: int = Query(8, ge=1, le=24 * 7),
                    limit: int = Query(2000, le=20000), s=Depends(session)):
    """Trend grafiği için. Ham okumalar."""
    since = D.utcnow() - timedelta(hours=hours)
    rows = s.scalars(
        select(D.MerkezVeri)
        .where(D.MerkezVeri.machine_id == machine_id, D.MerkezVeri.ts >= since)
        .order_by(D.MerkezVeri.ts.desc()).limit(limit)
    ).all()
    return [{"ts": r.ts, "total": r.total, "good": r.good,
             "rate": r.rate, "speed": r.speed, "valid": r.valid}
            for r in reversed(rows)]


@app.get("/machines/{machine_id}/oee")
def machine_oee(machine_id: str):
    eng = ENGINES.get(machine_id)
    if eng is None:
        raise HTTPException(404, "makine için canlı oturum yok")
    return eng.oee()


@app.get("/export.csv")
def export_csv(hours: int = Query(24, ge=1, le=24 * 30), s=Depends(session)):
    """Fabrikanın raporlama akışı Excel üzerinden yürüyor."""
    since = D.utcnow() - timedelta(hours=hours)
    rows = s.scalars(
        select(D.CihazDurumu)
        .where(D.CihazDurumu.kayit_tipi != D.KAYIT_TIPI_YAPILANDIRMA,
               D.CihazDurumu.start_ts >= since)
        .order_by(D.CihazDurumu.machine_id, D.CihazDurumu.start_ts)
    ).all()

    def gen():
        yield "makine,olay,baslangic,bitis,sure_dk,detay\n"
        for r in rows:
            mins = f"{r.duration_s/60:.1f}" if r.duration_s else ""
            meta = json.dumps(r.meta_json, ensure_ascii=False).replace(",", ";")
            yield f'{r.machine_id},{r.kayit_tipi},{r.start_ts},{r.end_ts or ""},{mins},"{meta}"\n'

    return StreamingResponse(
        gen(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=olaylar.csv"},
    )


@app.websocket("/live")
async def live(ws: WebSocket):
    await hub.join(ws)
    try:
        while True:
            await ws.receive_text()   # ping tutmak için
    except WebSocketDisconnect:
        await hub.leave(ws)
    except Exception:
        await hub.leave(ws)
