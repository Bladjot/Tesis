"""Local-only FastAPI acquisition service, with optional built frontend hosting."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import json
import threading
import time
from pathlib import Path
from typing import Literal

import numpy as np
import serial
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from serial.tools import list_ports

from .signal import (
    EMG_PRO_CHANNELS,
    EMG_PRO_FRAME_MAGIC,
    EMGProPacketDecoder,
    WindowBuffer,
    baseline_prediction,
    ensure_serial_backlog,
    ensure_serial_timing,
    extract_features,
    load_custom_predictor,
    parse_sample,
    validate_prediction,
)
from .expo import list_expo_models, load_expo_predictor, train_expo_model


logger = logging.getLogger("emg")
app = FastAPI(title="EMG Hand Lab", version="0.1.0")
LOCAL_ORIGINS = {
    f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 8765)
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class StreamConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    source: Literal["demo", "serial"] = "demo"
    port: str | None = Field(default=None, max_length=240)
    baudrate: int = Field(default=115200, ge=1200, le=3_000_000)
    sample_rate: int = Field(default=1000, ge=10, le=5000)
    channels: int = Field(default=8, ge=1, le=8)
    window_ms: int = Field(default=200, ge=50, le=2000)
    hop_ms: int = Field(default=50, ge=10, le=1000)
    rest: float = Field(default=0.05, ge=0, le=1e12)
    mvc: float = Field(default=0.6, gt=0, le=1e12)
    model: Literal["baseline", "custom", "expo"] = "baseline"
    model_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")

    @model_validator(mode="after")
    def validate_relationships(self):
        if self.mvc <= self.rest:
            raise ValueError("MVC debe ser mayor que reposo")
        if self.hop_ms > self.window_ms:
            raise ValueError("El salto no puede superar la ventana")
        if self.source == "serial" and not (self.port and self.port.strip()):
            raise ValueError("Selecciona un puerto para la fuente serial")
        if self.model == "expo" and not self.model_id:
            raise ValueError("Selecciona un modelo Expo entrenado")
        return self


class ExpoTrainingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=64)
    features: list[list[float]] = Field(min_length=1, max_length=4_000)
    labels: list[str] = Field(min_length=1, max_length=4_000)
    channels: int = Field(default=8, ge=1, le=8)
    sample_rate: int = Field(ge=10, le=5000)
    window_ms: int = Field(ge=50, le=2000)
    hop_ms: int = Field(default=50, ge=10, le=1000)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "EMG Hand Lab", "version": "0.1.0"}


@app.get("/api/ports")
async def ports():
    found = await asyncio.to_thread(list_ports.comports)
    return {"ports": [{"device": p.device, "description": p.description} for p in found]}


@app.get("/api/expo/models")
async def expo_models():
    return {"models": await asyncio.to_thread(list_expo_models)}


@app.post("/api/expo/train")
async def expo_train(request: ExpoTrainingRequest):
    try:
        metadata = await asyncio.to_thread(
            train_expo_model,
            request.name,
            request.features,
            request.labels,
            request.channels,
            request.sample_rate,
            request.window_ms,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"model": metadata}


@app.post("/api/expo/compare")
async def expo_compare(request: ExpoTrainingRequest):
    if request.hop_ms > request.window_ms:
        raise HTTPException(status_code=422, detail="El salto no puede superar la ventana")
    loop = asyncio.get_running_loop()
    events: asyncio.Queue = asyncio.Queue()
    cancelled = threading.Event()

    def report(event):
        if cancelled.is_set():
            raise ValueError("Entrenamiento cancelado")
        loop.call_soon_threadsafe(events.put_nowait, event)

    async def train():
        try:
            metadata = await asyncio.to_thread(
                train_expo_model, request.name, request.features, request.labels,
                request.channels, request.sample_rate, request.window_ms,
                compare=True, hop_ms=request.hop_ms, progress=report,
            )
            await events.put({"type": "result", "model": metadata})
        except Exception as exc:
            logger.exception("Expo comparison stopped")
            await events.put({"type": "error", "message": str(exc)})

    async def stream():
        task = asyncio.create_task(train())
        try:
            while True:
                event = await events.get()
                yield json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n"
                if event["type"] in ("result", "error"):
                    break
        finally:
            cancelled.set()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


async def emit_window(ws: WebSocket, completed, cfg: StreamConfig, predictor, source_unit: str | None = None):
    started = time.perf_counter()
    rms, mav = extract_features(completed.values)
    prediction = baseline_prediction(rms, cfg.rest, cfg.mvc)
    if predictor is not None:
        # Give adapters their own copy, and keep inference off the socket event loop.
        result = await asyncio.to_thread(predictor, completed.values.copy(), cfg.sample_rate)
        prediction.update(validate_prediction(result))
    processing_ms = (time.perf_counter() - started) * 1000
    if cfg.source == "serial":
        ensure_serial_timing(processing_ms, cfg.hop_ms)
    await ws.send_json({
        "type": "frame",
        "timestamp": (completed.sample_count - 1) / cfg.sample_rate,
        "samples": completed.samples,
        "rms": rms.tolist(),
        "mav": mav.tolist(),
        **prediction,
        "latency_ms": round(processing_ms, 3),
        "sample_count": completed.sample_count,
        "source": cfg.source,
        "model": cfg.model,
        "unit": source_unit or ("normalized" if cfg.source == "demo" else "raw"),
        "sample_rate": cfg.sample_rate,
        "window_ms": cfg.window_ms,
        "hop_ms": cfg.hop_ms,
    })
    if cfg.source == "serial":
        ensure_serial_timing((time.perf_counter() - started) * 1000, cfg.hop_ms)


async def demo_stream(ws: WebSocket, cfg: StreamConfig, predictor):
    buffer = WindowBuffer(cfg.sample_rate, cfg.channels, cfg.window_ms, cfg.hop_ms)
    rng = np.random.default_rng(42)
    batch_size = max(1, round(cfg.sample_rate * 0.05))
    period = batch_size / cfg.sample_rate
    deadline = time.perf_counter() + period
    while True:
        await asyncio.sleep(max(0.0, deadline - time.perf_counter()))
        for _ in range(batch_size):
            t = buffer.count / cfg.sample_rate
            envelope = 0.035 + 0.65 * (0.5 + 0.5 * math.sin(2 * math.pi * t / 8)) ** 2
            values = np.clip(rng.normal(0, envelope, cfg.channels), -1, 1).tolist()
            completed = buffer.add(values)
            if completed:
                await emit_window(ws, completed, cfg, predictor)
        # Do not build an unbounded catch-up queue if inference is slower than real time.
        deadline = max(deadline + period, time.perf_counter())


async def serial_stream(ws: WebSocket, cfg: StreamConfig, predictor):
    # Only permit enumerated local serial devices, never a client-supplied file or URL.
    found = await asyncio.to_thread(list_ports.comports)
    if cfg.port not in {p.device for p in found}:
        raise ValueError("El puerto no está disponible. Actualiza la lista de puertos")
    connection = serial.Serial(port=cfg.port, baudrate=cfg.baudrate, timeout=0, write_timeout=0)
    try:
        await ws.send_json({"type": "status", "message": f"Puerto {cfg.port} abierto; esperando muestras"})
        buffer = WindowBuffer(cfg.sample_rate, cfg.channels, cfg.window_ms, cfg.hop_ms)
        pending = bytearray()
        binary_decoder = EMGProPacketDecoder()
        serial_format: Literal["text", "emg_pro"] | None = None
        rejected = 0
        last_notice = time.perf_counter()
        while True:
            now = time.perf_counter()
            if rejected and now - last_notice >= 1:
                await ws.send_json({"type": "status", "message": f"Se descartaron {rejected} líneas inválidas; revisa formato y canales"})
                rejected = 0
                last_notice = now
            available_bytes = connection.in_waiting
            ensure_serial_backlog(available_bytes + len(pending) + binary_decoder.buffered_bytes)
            data = connection.read(min(available_bytes, 4096))
            if not data:
                await asyncio.sleep(0.005)
                continue
            decoded_samples: list[list[float]] = []
            if serial_format == "emg_pro":
                decoded_samples = binary_decoder.feed(data)
            else:
                pending.extend(data)
                ensure_serial_backlog(len(pending))
                if serial_format is None:
                    if EMG_PRO_FRAME_MAGIC in pending:
                        if cfg.channels != EMG_PRO_CHANNELS:
                            raise ValueError("El protocolo binario EMG PRO requiere 8 canales")
                        serial_format = "emg_pro"
                        decoded_samples = binary_decoder.feed(bytes(pending))
                        pending.clear()
                        await ws.send_json({
                            "type": "status",
                            "message": "Protocolo binario EMG PRO detectado · 8 canales normalizados",
                        })
                    elif b"\n" in pending:
                        serial_format = "text"
                        await ws.send_json({"type": "status", "message": "Flujo serial CSV/JSON detectado"})
                    elif len(pending) >= 4096:
                        raise ValueError("El flujo serial no coincide con CSV/JSON ni con el protocolo binario EMG PRO")
                if serial_format == "text":
                    while b"\n" in pending:
                        line, _, remainder = pending.partition(b"\n")
                        pending = bytearray(remainder)
                        try:
                            if len(line) > 4096:
                                raise ValueError("Línea demasiado larga")
                            decoded_samples.append(parse_sample(line.decode("utf-8"), cfg.channels))
                        except (ValueError, UnicodeDecodeError):
                            rejected += 1
            for values in decoded_samples:
                completed = buffer.add(values)
                if completed:
                    unit = "normalized-adc" if serial_format == "emg_pro" else "raw"
                    await emit_window(ws, completed, cfg, predictor, unit)
                    ensure_serial_backlog(
                        connection.in_waiting + len(pending) + binary_decoder.buffered_bytes
                    )
            await asyncio.sleep(0)
    finally:
        connection.close()


async def receive_until_disconnect(ws: WebSocket):
    while True:
        message = await ws.receive()
        if message["type"] == "websocket.disconnect":
            return
        # Stream configuration is immutable for the lifetime of a connection.
        # The frontend reconnects to apply changed settings.


@app.websocket("/ws/emg")
async def emg_socket(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin is not None and origin not in LOCAL_ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    tasks = set()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        if len(raw) > 4096:
            raise ValueError("Configuración demasiado larga")
        cfg = StreamConfig.model_validate_json(raw)
        if cfg.model == "custom":
            predictor = await asyncio.to_thread(load_custom_predictor)
        elif cfg.model == "expo":
            predictor = await asyncio.to_thread(load_expo_predictor, cfg.model_id)
        else:
            predictor = None
        await ws.send_json({
            "type": "status",
            "message": "Señal sintética activa · control RMS de demostración" if cfg.source == "demo" and cfg.model == "baseline"
            else f"Fuente {cfg.source} · modelo {cfg.model}",
        })
        producer = asyncio.create_task(demo_stream(ws, cfg, predictor) if cfg.source == "demo" else serial_stream(ws, cfg, predictor))
        receiver = asyncio.create_task(receive_until_disconnect(ws))
        tasks = {producer, receiver}
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except ValidationError as exc:
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "error", "message": "; ".join(e["msg"] for e in exc.errors())})
    except asyncio.TimeoutError:
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "error", "message": "No llegó la configuración inicial en 10 segundos"})
    except Exception as exc:
        logger.exception("EMG stream stopped")
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        with contextlib.suppress(Exception):
            await ws.close()


# API and WebSocket routes are registered before the static application mount.
dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
