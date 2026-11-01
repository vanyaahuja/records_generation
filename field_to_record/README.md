# Field-to-Record

Offline first-responder dictation to structured, evidence-linked records. Speak or type, inspect every extracted field, explicitly accept uncertainty, save immutable revisions, and export a handover note with a verifiable audit chain.

Synthetic-data hackathon prototype. Not clinically verified, not a treatment recommender, and not FHIR-conformant. Use synthetic dictations only. Provisional speech can change; human review is enforced by the API.

## Run locally on Windows

From this directory, provision dependencies and the model while online:

```powershell
py -3.11 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt -r backend/requirements-speech.txt -r backend/requirements-postgres.txt
backend/.venv/Scripts/python.exe tools/download_model.py tiny.en
cd frontend
npm ci
cd ..
./tools/dev.ps1
```

Open http://127.0.0.1:5173. The launcher starts the local backend on 8000 and warms the speech model. Start with an empty note before speaking; audio is appended to existing text. `Stop & extract` finalizes the transcript and creates the reviewable extraction.

For manual startup, copy `backend/.env.example` to `backend/.env`, then run `uvicorn app.main:app --host 127.0.0.1 --port 8000` from `backend` and `npm run dev` from `frontend`. On Linux use `python3.11 -m venv backend/.venv` and `backend/.venv/bin/python`; frontend commands are identical.

## Docker

Provision `models/whisper-tiny.en` with the command above before building. Model weights are copied into the image; no runtime downloads occur.

```powershell
cd field_to_record
docker compose build
docker compose up -d
backend/.venv/Scripts/python.exe tools/container_smoke.py
backend/.venv/Scripts/python.exe tools/container_verify.py
```

Run `cd field_to_record` only when starting from the repository root. All other commands in this README assume the application directory.

Open http://127.0.0.1:8080. Web, API and ASR are separate non-root application containers. Only the web/gateway port is published, bound to localhost. The Compose network is `internal: true`. A named volume retains SQLite data. After building and pulling images in advance, use `docker compose up --no-build --pull never -d` without networking.

Optional PostgreSQL deployment and replica guidance: [SCALING.md](docs/SCALING.md). All three images have been built and run locally. The deployed HTTP workflow, revision conflicts, five export formats, audit verification, uploaded audio and real-time PCM WebSocket transcription passed `container_verify.py`. The latest synthetic run produced its first nonempty provisional text in 970 ms; this is one measurement, not a latency guarantee.

Useful lifecycle and diagnostic commands:

```powershell
docker compose ps
docker compose logs --tail 100 api asr web
curl.exe http://127.0.0.1:8080/readyz
curl.exe http://127.0.0.1:8080/api/speech/status
docker compose restart asr
docker compose down
```

`down` preserves the records volume. Avoid `down -v` unless deliberately deleting stored records. Open the app directly at http://127.0.0.1:8080 in a browser and allow microphone access. A running Docker engine alone does not mean this project's ASR service is ready. If status reports ready but streaming fails, check that the proxy supports WebSocket upgrades and the browser origin is allowed. The default accepted Docker origins are `http://127.0.0.1:8080` and `http://localhost:8080`.

On the tested Windows machine, Docker Desktop's Windows client connection and download proxy stalled while its Linux engine remained running. `./tools/docker-desktop.ps1 compose ps` uses the installed Docker Desktop WSL client against that same engine. Substitute this wrapper for `docker` in the commands above if the Windows CLI hangs. It does not reset Docker or change unrelated containers. For wrapper arguments that collide with PowerShell options, pass `-DockerArgs @('compose','logs','--tail','100','asr')` explicitly.

If container package downloads fail but host downloads work, prepare Linux amd64 caches on the host before building:

```powershell
backend/.venv/Scripts/python.exe tools/prepare_offline.py
$env:OFFLINE_BUILD = '1'
./tools/docker-desktop.ps1 compose build
./tools/docker-desktop.ps1 compose up --no-build --pull never -d
```

Base images must already be available (`python:3.11-slim`, `node:22-bookworm-slim`, and `nginxinc/nginx-unprivileged:stable-alpine`). These caches and model weights are ignored by Git and must be provisioned on each build machine. Leave several GB of host disk space available: a full Windows drive can cause SQLite failures, truncated browser traces and Docker log I/O errors even while containers show as running.

For a prebuilt offline demo, save the images while the build machine has sufficient disk space, then copy the archive to the demo machine:

```powershell
docker save -o field-to-record-images.tar field-to-record-api:local field-to-record-asr:local field-to-record-web:local
docker load -i field-to-record-images.tar
docker compose up --no-build --pull never -d
```

## What the product does

- Live mono PCM audio through an AudioWorklet and WebSocket; provisional text and event candidates appear during speech.
- Warm local faster-whisper inference with bounded concurrency and buffering. Default: tiny.en int8 on CPU, 600 ms provisional interval, 700 ms silence endpoint.
- Typed or uploaded-audio workflow. No browser cloud speech API, hosted LLM, remote fonts, analytics or remote database in device mode.
- 125 medication names plus aliases, basic procedures and observations, spoken numbers, route/unit normalization, reported and relative clock times.
- Exact source offsets and raw evidence for extracted values. Missing values remain null; unknown drug suggestions never silently replace names.
- Per-event review and explicit acknowledgment of unresolved flags. Backend rejects stale narrative, missing review, invalid values and conflicting record versions.
- Immutable original extraction, append-only saved revisions, hash-linked audit entries and chain verification including the original extraction hash.
- Search/reopen, revision history, and revision-specific JSON, FHIR-lite, PDF, HTML and text exports.
- Precached PWA shell, responsive interface, memoized event cards, same-origin API requests and compact runtime bundle.

## Verification

```powershell
backend/.venv/Scripts/python.exe tools/contracts.py --check
backend/.venv/Scripts/python.exe -m pytest -q backend/tests
backend/.venv/Scripts/python.exe eval/run.py --check
backend/.venv/Scripts/python.exe eval/asr_bench.py --model models/whisper-tiny.en
backend/.venv/Scripts/python.exe eval/stream_bench.py
backend/.venv/Scripts/python.exe eval/load_bench.py
cd frontend
npm run build
npx playwright install chromium
npm run test:e2e
```

`tools/verify.ps1` runs the core checks on Windows. `Makefile` provides equivalent Linux commands. Frontend tests start isolated local API/frontend servers and use synthesized audio, including a fake microphone source. They do not require a physical microphone. CI also provisions PostgreSQL and runs its integration test. Set `TEST_POSTGRES_DSN` to run that test locally.

To run the browser suite against Docker instead of starting native test servers:

```powershell
cd frontend
$env:FTR_BASE_URL = 'http://127.0.0.1:8080'
npm run test:e2e
```

Reports live in [eval/reports](eval/reports). Synthetic gold contains 25 template families: 200 development cases, 100 cases from held-out families and eight implementation-authored challenge cases. These do not establish independent real-world accuracy. No independent wild set, noisy human-recorded dataset or clinical validation has been supplied. Literal ASR WER also penalizes spoken numbers transcribed as digits.

## Offline proof

The test suite forbids outbound socket connections during the full typed workflow and real local audio transcription. Browser checks assert that the standard workflow makes no requests to external origins. Docker uses an isolated runtime network with prepackaged assets. Still rehearse on the actual demo machine with Wi-Fi physically disabled, restart all services, dictate, review, save, export, reopen and verify the audit chain.

An installed PWA shell needs the local services for processing. A clean, unprovisioned machine cannot install Python packages or download model weights offline; prebuild/export the Docker images or prepare local package caches.

## Storage and privacy

Default storage is SQLite WAL. Optional payload encryption uses `RECORD_ENCRYPTION_KEY`, a base64-encoded random 32-byte key provided through the environment. Generate and retain your own key outside the database:

```powershell
$env:RECORD_ENCRYPTION_KEY = backend/.venv/Scripts/python.exe -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
```

Retain that key securely before restarting; losing it locks encrypted payloads. Enabling encryption encrypts new payloads, not existing plaintext rows. Record IDs, timestamps, actor metadata and audit hashes remain visible; use full-disk encryption for device protection. Audio is processed in memory and is not retained. Request logs contain route templates, timing and status, not transcripts. Reviewer identities are entered labels, not authenticated identities.

The chain is tamper-evident against partial changes. A privileged database owner can bypass triggers and recompute the entire chain; no external trust anchor or digital signature is provided. Legacy records from the old prototype remain in their old tables and are not automatically migrated into the new revision schema.

## API

- `GET /healthz`, `/readyz`, `/health`
- `POST /api/extract` persists the original extraction and returns `extraction_id`
- `POST /v1/extract` is stateless NLU for evaluation/worker use
- `POST /api/transcribe`, `WS /api/live`, `GET /api/speech/status`
- `POST /api/records`, `PUT /api/records/{id}` with `expected_version`
- `GET /api/records?q=...`, `GET /api/records/{id}?version=...`
- `GET /api/records/{id}/original`
- `GET /api/records/{id}/json|fhir|pdf|html|text?version=...`
- `GET /api/audit/verify`

Contract sources: [contracts](contracts), generated by `tools/contracts.py`. [Implementation decisions](docs/decisions.md), [plan status](docs/PLAN_STATUS.md), and [scaling limits](docs/SCALING.md) explicitly identify differences from the original plan and remaining verification.
