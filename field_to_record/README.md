# Field-to-Record — Offline-first prototype

Synthetic-data hackathon MVP: typed notes or microphone/audio-file input → optional local speech-to-text → rule-based event extraction → human review → JSON/PDF export → SQLite record and hash-linked audit event.

**Safety:** Not for clinical use, not a treatment recommender, and not a clinical verification engine. Use synthetic data only. Review all fields. Never infer missing clinical information.

## Stack
- React + Vite UI
- Python + FastAPI local API
- Rule-based extraction (transparent baseline; no cloud AI)
- Pydantic schemas
- SQLite local storage
- ReportLab PDF generation
- Optional faster-whisper with model files stored locally

## Setup
Backend (Windows PowerShell):
```powershell
cd backend
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Backend (macOS/Linux):
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Frontend (new terminal):
```bash
cd frontend
npm install
npm run dev
```
Open the local URL Vite prints. Backend health: http://127.0.0.1:8000/health

## Optional offline voice
1. Install the compatible local speech dependencies before disconnecting: `pip install -r requirements-speech.txt` from the `backend` folder. This pins PyAV below 16 because newer PyAV versions are incompatible with the decoder used by faster-whisper.
2. Download the `Systran/faster-whisper-small` model files into `models/whisper-small` (the folder must contain `model.bin`).
3. Add `WHISPER_MODEL_PATH=../models/whisper-small` to `backend/.env`. Put each setting on its own line; paths are relative to the backend folder.
4. Restart backend. Use **Record audio** or choose an audio file, then select **Transcribe locally**. The transcript is appended to any typed note; review the combined note before selecting **Extract events**.
5. Disconnect the network and repeat. If no local model is configured, typed input still works.

## Offline test
Install packages and model files before going offline. Start both apps, run typed extraction, edit/review events, save, export JSON/PDF, restart offline and repeat. Inspect network logs. No cloud API is used by the runtime application. For machines with no prior setup, prepare Python wheels and npm package cache in advance.

## API
- GET `/health`
- POST `/api/extract`
- POST `/api/transcribe` (optional local Whisper)
- POST `/api/records`
- GET `/api/records/{id}`
- GET `/api/records/{id}/json`
- GET `/api/records/{id}/pdf`

## Limitations
The MVP recognizes only a small fictional medication vocabulary and selected procedure/route patterns. It is not clinical-grade NER; complex negation, abbreviations, corrections and multi-event sentences may fail. FHIR-inspired JSON is not claimed to be FHIR-compliant. The audit hash chain is tamper-evident under limited assumptions, not immutable against a privileged database rewrite.
