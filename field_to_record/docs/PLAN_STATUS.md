# Implementation plan status

| Plan area | Current status |
|---|---|
| Scaffolding, health/readiness, Compose, CI | Implemented with Python services and Nginx instead of Go |
| Shared contracts | JSON Schema, OpenAPI and generated TypeScript; CI drift check |
| Lexicon | 125 medication entries plus aliases; no validated clinical dose ranges or terminology codes |
| Synthetic gold | 25 template families, 200 dev and 100 held-out cases; eight implementation-authored challenge cases |
| Human evaluation data | Not supplied; no claim of 50 human recordings or independent wild-set accuracy |
| Normalization | Spoken numbers, basic spoken/compact clock times, units and aliases; normalization offset property tests |
| Extraction | Clause assembly, medication/procedure/observation fields, missing/uncertainty/conflict flags and exact original evidence |
| Speech | Warm local Whisper, word probabilities, file upload, bounded PCM WebSocket streaming, real synthetic-audio and browser checks |
| Documentation | Source-only SOAP tables in text, HTML and PDF, SOAP JSON, FHIR-lite with provenance; project schema validation; empty sections remain undocumented |
| Audit | Immutable extraction and revision tables, parent revisions, hash chain, original-extraction hash and verification endpoint; tamper tests |
| Storage | SQLite WAL; optional pooled PostgreSQL with serialized audit commits; optional payload encryption |
| Review UI | SOAP event tables, optional field editor, evidence selection, explicit section/flag acceptance, add/remove, history and revision exports; monochrome light/dark themes and custom dropdowns/notifications |
| Patient dashboard | Capture-first layout, persisted name/age/gender registry, patient-linked record snapshots, observation/category/date filters, real-value charts and accessible tables, explicit bulk review confirmation; idempotent synthetic seed tool with 100 vital readings in 20 draft notes |
| PWA | Precached shell; local services still required for processing |
| Evaluation | Field precision/recall/F1, exact match, missing-field fabrication, source traceability, local HTTP load and synthetic ASR reports |
| Offline verification | Typed save/export/audit and real speech transcription with outbound sockets forbidden; actual Wi-Fi-off clean-device rehearsal still needed |
| Packaging | Multi-stage non-root application images, baked model, persistent storage, internal-only Compose network; config validation passes |
| Container execution | All three images built and healthy after host cache cleanup and an authorized Docker Desktop restart; deployed HTTP/revision/export/audit, audio upload and PCM WebSocket checks pass |
| Optional upgrades | AWS, cloud sync/outbox, trained ONNX NER, local LLM fallback and multilingual translation not implemented |

This is an evaluated hackathon prototype, not a clinical-grade extractor or a completed literal implementation of every optional item in the original plan. Rule-based negation scope, overlapping entities, unexpected corrections, ASR ambiguity and noisy environments remain important limits. Review is mandatory. No treatment recommendations are produced.
