from __future__ import annotations

import argparse
import logging
import os
import queue
import signal
import threading
import time
from pathlib import Path

from .capture import CaptureSupervisor
from .change_detection import mean_absolute_difference
from .config import load_config
from .ingest_bridge import IngestBridge
from .logging_config import configure_logging
from .metrics import Metrics, cpu_temperature
from .rapid_engine import RapidEngine
from .preprocessing import preprocess
from .result_store import ResultStore
from .roi import crop_roi, draw_rois
from .stabilization import Stabilizer

LOG = logging.getLogger(__name__)

# Makine kimliği ve merkez adresi ortam değişkeninden okunur.
# Böylece 10 Pi'de aynı kod durur, sadece /etc/default/pi-capture-ocr farklıdır.
MACHINE_ID = os.environ.get("JWC_MACHINE_ID", "MAK-01")
API_URL = os.environ.get("JWC_API_URL", "http://127.0.0.1:8000")
INGEST_ENABLED = os.environ.get("JWC_INGEST", "1") not in {"0", "false", "no"}


class Service:
    def __init__(self, config_path: str):
        self.config_path = config_path
        self.config = load_config(config_path)
        self.ocr_backend = "rapidocr"
        self.metrics = Metrics()
        self.store = ResultStore(self.config.output.results_file)
        self.frames: queue.Queue = queue.Queue(maxsize=1)
        self.jobs: queue.Queue = queue.Queue(maxsize=max(2, self.config.ocr.workers * 2))
        self.stop_event = threading.Event()
        self.capture = CaptureSupervisor(self.config, self.frames, self.store, self.metrics)
        self.stabilizers = {r.id: Stabilizer(r.stability_mode, r.stability_window, r.consecutive_required)
                            for r in self.config.rois}
        self.previous: dict[str, object] = {}
        self.last_ocr: dict[str, float] = {}
        self.last_frame_wall: float | None = None
        self.worker_alive = 0
        self._threads: list[threading.Thread] = []

        # Anlık görüntü: en son karenin ham referansı, mobil "Anlık Görüntü Al" için.
        # Kasıtlı olarak burada JPEG'e KODLAMIYORUZ — bu iş her karede (sürekli,
        # kimse izlemese bile) yapılırsa Pi'ye gereksiz sürekli CPU yükü biner
        # (zaten ısınan bir cihazda). Kodlama sadece /frame.jpg gerçekten
        # istendiğinde, o an, tek seferlik yapılıyor (bkz. create_snapshot_app).
        self.last_frame = None
        self._frame_lock = threading.Lock()

        # Merkeze köprü. ResultStore anlık durumu tutmaya devam ediyor;
        # bu köprü aynı değerleri olay motoruna ve veritabanına taşıyor.
        self.bridge = IngestBridge(
            api_url=API_URL,
            machine_id=MACHINE_ID,
            min_interval=0.5,
            spool_path=str(Path(self.config.output.results_file).parent / "spool.jsonl"),
        ) if INGEST_ENABLED else None
        if self.bridge:
            LOG.info("Ingest köprüsü etkin: %s -> %s", MACHINE_ID, API_URL)

    def start(self):
        self._threads.append(threading.Thread(target=self.capture.run, name="capture", daemon=True))
        self._threads.append(threading.Thread(target=self._dispatch, name="dispatcher", daemon=True))
        for index in range(self.config.ocr.workers):
            self._threads.append(threading.Thread(target=self._worker, name=f"ocr-{index}", daemon=True))
        for thread in self._threads: thread.start()

    def _dispatch(self):
        while not self.stop_event.is_set():
            try: frame = self.frames.get(timeout=.5)
            except queue.Empty: continue
            self.last_frame_wall = time.time()
            with self._frame_lock:
                self.last_frame = frame  # kopyalamıyoruz — neredeyse bedava, sadece referans
            for cfg in self.config.rois:
                try:
                    raw_roi = crop_roi(frame, cfg)
                    now = time.monotonic()
                    threshold = cfg.change_threshold if cfg.change_threshold is not None else self.config.ocr.change_threshold
                    refresh = cfg.refresh_interval if cfg.refresh_interval is not None else self.config.ocr.force_refresh_seconds
                    difference = mean_absolute_difference(self.previous.get(cfg.id), raw_roi)
                    due = now - self.last_ocr.get(cfg.id, 0) >= refresh
                    self.previous[cfg.id] = raw_roi
                    if self.config.ocr.use_change_detection and difference < threshold and not due:
                        self.metrics.skipped_ocr += 1
                        continue
                    self.last_ocr[cfg.id] = now
                    try: self.jobs.put_nowait((cfg, raw_roi))
                    except queue.Full: self.metrics.dropped_frames += 1
                except Exception:
                    LOG.exception("Failed to prepare ROI %s", cfg.id)

    def _worker(self):
        try:
            engine = RapidEngine(self.config.ocr.language)
        except Exception:
            LOG.exception("Cannot initialize OCR worker (pip install rapidocr onnxruntime)")
            return
        self.worker_alive += 1
        try:
            while not self.stop_event.is_set():
                try: cfg, image = self.jobs.get(timeout=.5)
                except queue.Empty: continue
                try:
                    started = time.perf_counter(); processed = preprocess(image, cfg)
                    self.metrics.preprocess_times[cfg.id].append(time.perf_counter() - started)
                    if self.config.output.save_debug_images:
                        import cv2
                        directory = Path(self.config.output.debug_dir); directory.mkdir(parents=True, exist_ok=True)
                        cv2.imwrite(str(directory / f"{cfg.id}.png"), processed)
                    started = time.perf_counter(); result = engine.recognize(processed, cfg)
                    self.metrics.ocr_times.append(time.perf_counter() - started)
                    if not result.valid:
                        LOG.warning("ROI %s rejected OCR value %r (confidence %.1f)", cfg.id, result.value, result.confidence)
                        continue
                    stable, changed = self.stabilizers[cfg.id].add(result.value)
                    if stable is not None:
                        self.store.update(cfg.id, stable, result.raw_value, result.confidence, changed)
                        if self.bridge:
                            self.bridge.update(cfg.id, stable, result.confidence)
                        if changed: LOG.info("ROI %s changed: %s (%.1f%%)", cfg.id, stable, result.confidence)
                except Exception:
                    LOG.exception("OCR worker failed for ROI %s", cfg.id)
        finally:
            engine.close(); self.worker_alive -= 1

    def get_snapshot(self) -> bytes | None:
        """İstek anında, tek seferlik JPEG kodlar. Arka planda sürekli çalışan bir şey yok."""
        with self._frame_lock:
            frame = self.last_frame
        if frame is None:
            return None
        try:
            import cv2
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            return buf.tobytes() if ok else None
        except Exception:
            LOG.exception("Anlık görüntü kodlanamadı")
            return None

    def health(self):
        snapshot = self.metrics.snapshot()
        data = {"machine_id": MACHINE_ID, "ocr_backend": self.ocr_backend,
                "capture_online": self.store.snapshot()["capture_online"],
                "display_online": self.capture.display_online, "ocr_workers_alive": self.worker_alive,
                "ocr_workers_configured": self.config.ocr.workers,
                "last_frame_time": self.last_frame_wall, "uptime_seconds": snapshot["uptime_seconds"],
                "cpu_temperature_c": cpu_temperature(), "average_ocr_ms": snapshot["average_ocr_ms"]}
        if self.bridge:
            data.update(self.bridge.health())
        return data

    def request_reload(self):
        new = load_config(self.config_path)
        # Capture-relevant settings take effect through a controlled pipeline restart.
        self.config = new; self.capture.config = new
        self.stabilizers = {r.id: self.stabilizers.get(r.id) or Stabilizer(r.stability_mode, r.stability_window,
                             r.consecutive_required) for r in new.rois}
        self.capture.restart_event.set()

    def stop(self):
        self.stop_event.set()
        if self.bridge: self.bridge.stop()
        self.capture.stop()
        for thread in self._threads: thread.join(timeout=3)


def wait_for_frame(service: Service, timeout: float = 15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        previous = service.previous
        if previous:
            # Reconstructing a whole frame is impossible; calibration uses direct one-shot OpenCV below.
            break
        time.sleep(.1)


def capture_calibration_frame(config, output: str, preview: bool = False):
    import cv2
    import numpy as np
    cap = cv2.VideoCapture(config.capture.device, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.capture.width); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.capture.height)
    cap.set(cv2.CAP_PROP_FPS, config.capture.fps)
    if config.capture.format.upper() in {"MJPG", "MJPEG"}:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    # UVC HDMI devices commonly emit stale/black frames while the HDMI handshake
    # and MJPEG decoder settle. Drain roughly two seconds and retain the most
    # information-rich recent frame instead of blindly saving the first buffer.
    frame = None
    best_score = -1.0
    deadline = time.monotonic() + 3.0
    successful = 0
    while time.monotonic() < deadline and successful < max(30, config.capture.fps * 2):
        ok, candidate = cap.read()
        if not ok:
            continue
        successful += 1
        gray = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY)
        score = float(np.mean(gray) + np.std(gray))
        if score > best_score:
            frame, best_score = candidate.copy(), score
    cap.release()
    if frame is None:
        raise RuntimeError(f"Cannot capture a frame from {config.capture.device}")
    if best_score < 1.0:
        LOG.warning("Capture succeeded but all warm-up frames are effectively black")
    if preview: frame = draw_rois(frame, config.rois)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(output, frame): raise RuntimeError(f"Cannot write {output}")


def create_snapshot_app(service: "Service"):
    """Mobil "Anlık Görüntü Al" için ayrı, hafif bir HTTP sunucusu.

    api.py'ye (hocanın iskeleti) dokunmadan çalışması için kasıtlı olarak
    ayrı bir port kullanıyor.
    """
    from fastapi import FastAPI, Response

    app = FastAPI()

    @app.get("/frame.jpg")
    def frame_jpg():
        data = service.get_snapshot()
        if data is None:
            return Response(status_code=404)
        return Response(content=data, media_type="image/jpeg")

    return app


def cli(argv=None):
    parser = argparse.ArgumentParser(description="Raspberry Pi HDMI passthrough and multi-ROI OCR")
    parser.add_argument("--config", default="config/config.yaml")
    parser.add_argument("--benchmark", action="store_true")
    parser.add_argument("--benchmark-seconds", type=int, default=30)
    parser.add_argument("--capture-frame")
    parser.add_argument("--preview-rois")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv); configure_logging(args.verbose)
    config = load_config(args.config)
    if args.capture_frame or args.preview_rois:
        capture_calibration_frame(config, args.capture_frame or args.preview_rois, bool(args.preview_rois)); return
    service = Service(args.config); service.start()
    stopping = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM): signal.signal(sig, lambda *_: stopping.set())
    api_thread = None
    if config.api.enabled and not args.benchmark:
        import uvicorn
        from .api import create_app
        api_thread = threading.Thread(target=uvicorn.run, args=(create_app(service),),
            kwargs={"host": config.api.host, "port": config.api.port, "log_level": "info"}, daemon=True)
        api_thread.start()

        snapshot_port = config.api.port + 10  # 8080 -> 8090
        snapshot_thread = threading.Thread(target=uvicorn.run, args=(create_snapshot_app(service),),
            kwargs={"host": config.api.host, "port": snapshot_port, "log_level": "warning"}, daemon=True)
        snapshot_thread.start()
        LOG.info("Anlık görüntü sunucusu: http://%s:%d/frame.jpg", config.api.host, snapshot_port)
    try:
        if args.benchmark:
            stopping.wait(args.benchmark_seconds)
            report = service.metrics.snapshot()
            report.update({"capture_configured_fps": config.capture.fps,
                           "display_estimated_fps": config.capture.fps if service.capture.display_online else 0,
                           "total_ocr_work_ms": round(sum(service.metrics.ocr_times) * 1000, 2)})
            import json
            print(json.dumps(report, indent=2))
        else:
            while not stopping.wait(1): pass
    finally: service.stop()


if __name__ == "__main__": cli()
