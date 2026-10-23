"""Warm local ASR with bounded inference and PCM WebSocket streaming."""

import asyncio, io, os, time, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from fastapi import (
    APIRouter,
    HTTPException,
    UploadFile,
    File,
    WebSocket,
    WebSocketDisconnect,
)
from .extraction import extract_events

router = APIRouter()
BACKEND_DIR = Path(__file__).resolve().parents[1]


def resolve_whisper_model_path(configured_path):
    if not configured_path or not configured_path.strip():
        raise HTTPException(
            503,
            "Local Whisper is not configured. Use typed input or set WHISPER_MODEL_PATH.",
        )
    p = Path(configured_path.strip().strip('"').strip("'"))
    if not p.is_absolute():
        p = BACKEND_DIR / p
    p = p.resolve()
    if not p.is_dir() or not (p / "model.bin").is_file():
        raise HTTPException(
            503,
            f"Local Whisper model files were not found at {p}; keep each .env setting on its own line.",
        )
    return str(p)


class SpeechEngine:
    def __init__(self):
        self.model = None
        self.error = None
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="local-asr")
        self.active = 0
        self.sessions = 0
        self.guard = threading.Lock()

    def load(self):
        with self.lock:
            if self.model:
                return
            path = resolve_whisper_model_path(os.getenv("WHISPER_MODEL_PATH", ""))
            try:
                import numpy as np
                from faster_whisper import WhisperModel

                self.model = WhisperModel(
                    path,
                    device=os.getenv("WHISPER_DEVICE", "cpu"),
                    compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
                    cpu_threads=int(os.getenv("WHISPER_CPU_THREADS", "4")),
                    num_workers=1,
                    local_files_only=True,
                )
                # Warm kernels and tokenizer before readiness becomes true.
                segments, _ = self.model.transcribe(
                    np.zeros(16000, dtype=np.float32),
                    language="en",
                    beam_size=1,
                    vad_filter=False,
                )
                list(segments)
                self.error = None
            except Exception as exc:
                self.model = None
                self.error = type(exc).__name__
                raise HTTPException(
                    503, "Local speech initialization failed: " + self.error
                ) from exc

    def status(self):
        return {
            "ready": self.model is not None,
            "error": self.error,
            "active": self.active,
            "sessions": self.sessions,
            "max_sessions": int(os.getenv("MAX_SPEECH_SESSIONS", "4")),
            "model": Path(os.getenv("WHISPER_MODEL_PATH", "unconfigured")).name,
        }

    def _decode(self, audio, partial):
        import numpy as np

        self.load()
        start = time.perf_counter()
        pcm = (
            np.frombuffer(audio, dtype="<i2").astype(np.float32) / 32768
            if isinstance(audio, bytes)
            else audio
        )
        segments, info = self.model.transcribe(
            pcm,
            language="en",
            beam_size=1,
            best_of=1,
            temperature=0,
            condition_on_previous_text=False,
            word_timestamps=not partial,
            vad_filter=not isinstance(pcm, np.ndarray),
        )
        output = list(segments)
        words = [
            {"w": w.word.strip(), "start": w.start, "end": w.end, "prob": w.probability}
            for s in output
            for w in (s.words or [])
        ]
        duration = len(pcm) / 16000 if isinstance(pcm, np.ndarray) else info.duration
        elapsed = (time.perf_counter() - start) * 1000
        return {
            "text": " ".join(s.text.strip() for s in output).strip(),
            "segments": [
                {"text": s.text.strip(), "start": s.start, "end": s.end} for s in output
            ],
            "words": words,
            "duration": duration,
            "rtf": elapsed / 1000 / max(duration, 0.001),
            "inference_ms": round(elapsed, 2),
            "language": info.language,
            "model": Path(os.getenv("WHISPER_MODEL_PATH", "")).name,
        }

    async def decode(self, audio, partial=False):
        with self.guard:
            if self.active:
                raise HTTPException(
                    429, "Speech worker is busy. Retry or add ASR replicas."
                )
            self.active += 1
        try:
            future = asyncio.get_running_loop().run_in_executor(
                self.pool, self._decode, audio, partial
            )
            try:
                return await asyncio.shield(future)
            except asyncio.CancelledError:
                await future
                raise
        finally:
            with self.guard:
                self.active -= 1


engine = SpeechEngine()


@router.get("/api/speech/status")
def speech_status():
    return engine.status()


@router.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    resolve_whisper_model_path(os.getenv("WHISPER_MODEL_PATH", ""))
    limit = int(os.getenv("MAX_AUDIO_MB", "25")) * 1024 * 1024
    content = bytearray()
    while chunk := await file.read(65536):
        content.extend(chunk)
        if len(content) > limit:
            raise HTTPException(413, "Audio exceeds configured size limit.")
    if not content:
        raise HTTPException(422, "Empty audio.")
    try:
        # Compressed files are decoded by PyAV; PCM stream chunks bypass that work.
        result = await engine.decode(io.BytesIO(content))
        result["notice"] = "Review names, numbers, units and times before confirmation."
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            422, "Audio decoding failed: " + type(exc).__name__
        ) from exc


@router.websocket("/api/live")
async def live(ws: WebSocket):
    allowed = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
    origin = ws.headers.get("origin")
    if origin and origin not in allowed:
        return await ws.close(code=1008)
    await ws.accept()
    with engine.guard:
        full = engine.sessions >= int(os.getenv("MAX_SPEECH_SESSIONS", "4"))
        if not full:
            engine.sessions += 1
    if full:
        await ws.send_json(
            {"type": "error", "message": "Speech capacity reached. Retry shortly."}
        )
        return await ws.close(code=1013)
    queue = asyncio.Queue(maxsize=200)

    async def receive():
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    data = message["bytes"]
                    if len(data) > 32000 or len(data) % 2:
                        raise ValueError("Invalid PCM frame")
                    queue.put_nowait(data)
                elif message.get("text") == "stop":
                    break
                else:
                    raise ValueError("Expected PCM16 binary frames or stop")
        except (WebSocketDisconnect, RuntimeError):
            pass
        except (ValueError, asyncio.QueueFull):
            await ws.close(code=1009, reason="Audio backlog or malformed frame")
        finally:
            # A sentinel must fit even after overload.
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(None)

    reader = None
    try:
        if not engine.model:
            await ws.send_json(
                {"type": "loading", "message": "Warming local speech model"}
            )
            await asyncio.to_thread(engine.load)
        interval = max(300, int(os.getenv("PARTIAL_INTERVAL_MS", "600")))
        await ws.send_json(
            {
                "type": "ready",
                "sample_rate": 16000,
                "format": "pcm_s16le",
                "partial_interval_ms": interval,
            }
        )
        reader = asyncio.create_task(receive())
        import numpy as np

        buffer = bytearray()
        pre_roll = bytearray()
        speech = False
        silence = 0
        total = 0
        last_partial = 0
        committed = ""
        seq = 0
        threshold = float(os.getenv("VAD_RMS_THRESHOLD", ".009"))
        while True:
            data = await queue.get()
            stop = data is None
            batch = [data] if data else []
            while not queue.empty() and not stop:
                item = queue.get_nowait()
                if item is None:
                    stop = True
                else:
                    batch.append(item)
            for chunk in batch:
                total += len(chunk)
                if total > 16000 * 2 * 60 * 15:
                    await ws.send_json(
                        {
                            "type": "error",
                            "message": "15 minute session limit reached; start a new note.",
                        }
                    )
                    stop = True
                    break
                pcm = np.frombuffer(chunk, dtype="<i2").astype(np.float32) / 32768
                voiced = float(np.sqrt(np.mean(pcm * pcm))) >= threshold
                if voiced:
                    if not speech:
                        buffer.extend(pre_roll)
                        pre_roll.clear()
                    speech = True
                    silence = 0
                else:
                    silence += len(chunk) / 32
                if speech:
                    buffer.extend(chunk)
                else:
                    pre_roll.extend(chunk)
                    if len(pre_roll) > 6400:
                        del pre_roll[:-6400]
            duration = len(buffer) / 32
            if duration > 20000:
                raise HTTPException(
                    429,
                    "Speech inference is falling behind. Stop and retry or add ASR capacity.",
                )
            finalize = bool(buffer) and (
                stop
                or silence >= int(os.getenv("ENDPOINT_SILENCE_MS", "700"))
                or duration >= 10000
            )
            partial = (
                bool(buffer)
                and not finalize
                and duration - last_partial >= interval
                and duration >= interval
            )
            if (partial or finalize) and speech:
                try:
                    result = await engine.decode(bytes(buffer), partial=partial)
                except HTTPException as exc:
                    if exc.status_code != 429:
                        raise
                    await ws.send_json({"type": "backpressure", "message": exc.detail})
                    if stop:
                        raise
                    # Keep audio; skip speculative partial work while busy.
                    await asyncio.sleep(0.05)
                    continue
                seq += 1
                text = result["text"]
                if finalize and text:
                    committed = " ".join([committed, text]).strip()
                preview = committed if finalize else " ".join([committed, text]).strip()
                await ws.send_json(
                    {
                        "type": "final" if finalize else "partial",
                        "seq": seq,
                        "text": text,
                        "transcript": preview,
                        "words": result["words"],
                        "events": [e.model_dump() for e in extract_events(preview)],
                        "inference_ms": result["inference_ms"],
                        "rtf": result["rtf"],
                        "audio_ms": round(duration),
                        "provisional": not finalize,
                    }
                )
                last_partial = duration
            if finalize:
                buffer.clear()
                speech = False
                silence = 0
                last_partial = 0
            if stop:
                await ws.send_json({"type": "complete", "transcript": committed})
                break
        await ws.close()
    except (WebSocketDisconnect, RuntimeError):
        pass
    except HTTPException as exc:
        await ws.send_json({"type": "error", "message": str(exc.detail)})
        await ws.close(code=1013)
    finally:
        if reader:
            reader.cancel()
            try:
                await reader
            except asyncio.CancelledError:
                pass
        with engine.guard:
            engine.sessions -= 1
