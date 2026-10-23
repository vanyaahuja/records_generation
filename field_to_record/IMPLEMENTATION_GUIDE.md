# Implementation guide

The current system is documented in [README.md](README.md). The old fictional-vocabulary baseline has been replaced with evidence-linked extraction, streaming speech, enforced review, immutable revisions and revision-specific exports.

Browser → Nginx gateway → record API / independent ASR worker. The record API uses in-process rules and deterministic rendering to minimize local overhead; SQLite WAL supports the edge device and PostgreSQL supports a shared server. All runtime assets and speech weights are local. See [architecture decisions](docs/decisions.md) for deliberate differences from the supplied Go-based plan.

The core flow is capture → original extraction stored → per-event review → append-only revision → deterministic exports → audit verification. The original narrative and extraction cannot be edited in place. Changing the narrative requires a new extraction. Edits to saved events require an expected revision and cannot silently overwrite concurrent changes.

Speech is chunked local transcription, not guaranteed instantaneous recognition or multilingual translation. The frontend streams 100 ms PCM frames; provisional inference is requested every 600 ms of buffered speech, and finalization follows 700 ms of silence. The backend warms one model per worker, keeps inference outside the event loop, bounds sessions and audio queues, and signals overload. Actual measurements are in `eval/reports`.

Run the verification commands in the README after changes. The complete status, including unverified container execution, independent human data and optional upgrades, is in [PLAN_STATUS.md](docs/PLAN_STATUS.md).
