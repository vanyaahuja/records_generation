# Latency and scaling

The latency budget has three independent parts: audio collection (600 ms for the first speculative update), model inference, and endpointing (700 ms of silence before finalization). Provisional words may change. The UI presents them separately; they cannot be confirmed until final extraction and review.

Each ASR replica loads its model once at startup, warms it before readiness, owns one inference worker, and accepts at most four capture sessions by default. Inference runs outside the event loop. Audio frames are bounded; overload returns explicit backpressure or an error rather than accumulating unbounded work. Increasing `MAX_SPEECH_SESSIONS` does not increase inference throughput.

On CPU, begin with tiny.en int8, four inference threads and one replica. Benchmark before increasing threads: overcommitting cores across replicas can increase p95 latency. Change `MODEL_DIR=whisper-base.en` or `whisper-small` before building to compare accuracy. GPU configurations require the matching CTranslate2/CUDA runtime image; the supplied image is CPU-oriented and has not been GPU-tested.

API handlers keep speech inference separate. Compiled extraction patterns and the lexicon load once. SQLite uses WAL, short write transactions and optimistic version checks. The React interface uses memoized event cards, a reducer, and audio-thread processing; no React update is dispatched for every audio frame. Static assets use gzip and long-lived hashed URLs. No remote fonts or runtime UI library are loaded.

For a shared server, use PostgreSQL before scaling record API replicas:

```powershell
$env:POSTGRES_PASSWORD = 'choose-a-local-secret'
docker compose -f compose.yml -f deploy/compose.postgres.yml up --build -d --scale api=2 --scale asr=2
```

Nginx uses Docker DNS with dynamic resolution and least connections for ASR. A WebSocket remains attached to one replica for its lifetime. In-flight audio is not replicated or recovered after a replica failure; finalized text remains in the browser. The default stack publishes only localhost:8080. LAN or public use needs HTTPS, authentication, rate limiting and an explicit allowed origin; do not expose the development server as a shared clinical service.

There is no demonstrated distributed capacity number yet. The PostgreSQL integration test and container smoke test are configured in CI but were not executed locally because Docker Desktop's engine was unavailable. Local CPU throughput and latency are recorded in `eval/reports/load.json`; acoustic results are in `*-asr.json` and `stream.json`. A single global audit chain serializes commits and will limit write scaling even with more API replicas. Per-device anchored chains would be a separate design change.
