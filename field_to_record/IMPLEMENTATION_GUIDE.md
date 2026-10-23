# Field-to-Record — Implementation and Technical Explanation

## 1. Project purpose and safety boundary
Field-to-Record converts typed or spoken synthetic first-responder notes into structured medication/procedure event candidates. It preserves source text, flags uncertainty/missing fields, supports human review, stores records locally, and exports JSON/PDF. It is a hackathon prototype—not a medical device, treatment recommender, or clinical verification system. Use synthetic data only.

## 2. End-to-end workflow
1. User enters a case ID, responder role, and typed note, records audio from the microphone, or selects an audio file.
2. Optional local speech-to-text uses faster-whisper with a model downloaded before going offline. The transcript is appended to any typed note and remains editable; users should verify medication names, numbers, units, routes, and times.
3. FastAPI receives the narrative at `/api/extract`.
4. Transparent Python rules split sentences and identify a small fictional medication vocabulary, simple dose/unit patterns, selected route terms, procedures, clock times, negation and uncertainty. Unsupported statements remain in the structured event list for manual review.
5. Unsupported statements are retained as `unclassified`, rather than silently discarded.
6. Pydantic models define the event structure. This validates data shape, not clinical correctness.
7. Human reviewer inspects source text and edits candidate fields.
8. `/api/records` stores the reviewed record in SQLite and appends a hash-linked audit event.
9. JSON and PDF are generated locally and downloaded from the UI.

## 3. Architecture
Browser UI (React/Vite) → local FastAPI (`127.0.0.1:8000`) → extraction rules → Pydantic-shaped events → human review → SQLite record/audit → JSON/PDF.
Optional audio follows a local path: audio file → local faster-whisper model → editable transcript → same extraction path. No cloud LLM or hosted transcription is used.

## 4. Technology stack and rationale
| Technology | Role | Why |
|---|---|---|
| React + Vite | User interface | Fast development of input, review and export screens |
| Python + FastAPI | Local API | Connects modules with typed request validation |
| faster-whisper (optional) | Local speech recognition | Uses a local model instead of a hosted transcription API |
| Regex + dictionaries | MVP extraction | Transparent, quick to build and easy to explain/test |
| Pydantic | Schema validation | Checks event field types and allowed values |
| SQLite | Local storage | A file-based database; no database server or cloud |
| ReportLab | PDF generation | Builds documents locally |
| SHA-256 chain | Audit evidence | Helps detect partial changes; not absolute immutability |

## 5. Integrations and dependencies
- **React ↔ FastAPI:** local HTTP requests to localhost. No hosted API.
- **faster-whisper:** optional packages from `backend/requirements-speech.txt` and a local model directory. Download/setup is done in advance. The speech requirements cap PyAV below 16 for compatibility with faster-whisper's audio decoder. Configure `WHISPER_MODEL_PATH` to a local path; do not configure a remote model identifier.
- **Pydantic:** integrated into API request schemas and event records.
- **SQLite:** local database file, created automatically.
- **ReportLab:** local PDF output.
- **spaCy:** not required in this MVP. It can later provide EntityRuler or a trained NER model; package and model must be local.
- **FHIR:** this prototype produces project-specific JSON only. A later version may map events to FHIR R4 `MedicationAdministration` and `Procedure`, then validate the selected profile before claiming compliance.

## 6. Step-by-step build plan
1. Install Python and Node.js; create the virtual environment and install backend dependencies.
2. Start FastAPI and confirm `GET /health`.
3. Call `POST /api/extract` with synthetic notes; inspect JSON events.
4. Run the React frontend and verify typed note submission.
5. Inspect source text, status, missing-field flags, and edit candidate fields.
6. Confirm review and save. Verify SQLite record and audit entry.
7. Download JSON and PDF; check narrative, events, statuses, and audit details.
8. Optionally install faster-whisper and configure a local model directory.
9. Disable network and test typed input, review, save, export, restart, and optional transcription.

## 7. Data fields and timestamps
Each event includes `event_id`, `event_type`, `description`, optional `medication`, `dose`, `route`, `event_time`, `time_source`, `status`, `source_text`, `review_status`, and `flags`. The record includes case ID, responder ID, narrative, record status, `recorded_at`, `updated_at`, and reviewer ID.
- `event_time`: time stated in the source narrative; null if unknown.
- `recorded_at`: time the record is saved.
- `updated_at`: latest saved update.
The baseline recognizes clock strings only; it does not infer date or time zone. Never replace event time with record creation time or guess missing clinical information.

## 8. Data and model strategy
For the first demo, use synthetic dictations with manually written expected outputs. Cover positive examples, missing fields, negation, uncertainty, corrections, multiple events and noisy audio.
MIMIC-III access generally requires credentialing, training and a data-use agreement. n2c2 access/licensing varies by challenge dataset. Check the exact terms and suitability before use. Neither corpus should be assumed to contain precisely labelled first-responder dictations.
For future NER training: define annotation guidelines; annotate authorized examples; split by case into train/validation/test; train a local spaCy model or use hybrid rules + NER; report precision, recall and F1 by entity and evaluate event grouping and negation separately.

## 9. Offline guarantee
Dependencies and model files must be downloaded in advance. Runtime processing stays local. Do not add hosted LLM, remote database, telemetry, analytics or transcription calls. Start services on localhost. Disable Wi-Fi/Ethernet, restart both apps and repeat the complete workflow. Inspect network logs. A truly unprovisioned machine needs local Python wheels and npm packages prepared in advance.

## 10. Audit trail limitations
Each saved record creates an audit event with actor, action, timestamp, payload hash, previous hash and entry hash. This is tamper-evident under limited assumptions, not immutable: a privileged user able to rewrite the database can recompute hashes. This MVP does not include authentication, encryption at rest, digital signatures, backup policy or production access controls.

## 11. Testing
- Positive medication note with dose, route and time.
- Negated mention should not be represented as a confirmed administration.
- Uncertainty and missing dose should be flagged; no dose is invented.
- Procedure mention with event time.
- Unknown sentence is preserved for review.
- Audio numbers/medication terms are checked against the recording.
- Save, retrieve, JSON export and PDF export succeed.
- Audit event is created on save.
- End-to-end workflow succeeds after network disconnection and restart.

Run backend tests: `cd backend`, install pytest, then `pytest -q`.

## 12. API endpoints
- `GET /health`: backend status and speech configuration.
- `POST /api/extract`: narrative to candidate events.
- `POST /api/transcribe`: audio to transcript; local model required.
- `POST /api/records`: save reviewed record.
- `GET /api/records/{id}`: retrieve record and audit history.
- `GET /api/records/{id}/json`: JSON download.
- `GET /api/records/{id}/pdf`: PDF download.

## 13. Honest demo script
Start the backend and frontend, load the synthetic note, extract events, show source text and flags, edit/confirm candidates, save and show the record ID/audit trail, export JSON/PDF, then disconnect the network and repeat. Test voice only if the local model is installed. State clearly that extraction is a baseline and all fields require human review.

## 14. Known limitations and priorities
Rules only cover a small vocabulary and simple patterns; negation scope, abbreviations, corrections, and multi-event grouping can fail. This is not clinical-grade NER. Prioritize typed extraction → review UI → local save/audit → exports → optional Whisper → offline test → larger test set → optional trained NER and formal FHIR validation.
