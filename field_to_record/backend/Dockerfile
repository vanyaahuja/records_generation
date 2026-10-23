FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt backend/constraints.txt ./
COPY deploy/wheels/ /wheelhouse/
ARG OFFLINE_BUILD=0
RUN if [ "$OFFLINE_BUILD" = "1" ]; then pip install --no-index --find-links=/wheelhouse --prefix=/install -c constraints.txt -r requirements.txt; else pip install --find-links=/wheelhouse --prefix=/install -c constraints.txt -r requirements.txt; fi

FROM base AS api-deps
COPY backend/requirements-postgres.txt .
RUN if [ "$OFFLINE_BUILD" = "1" ]; then pip install --no-index --find-links=/wheelhouse --prefix=/install -c constraints.txt -r requirements-postgres.txt; else pip install --find-links=/wheelhouse --prefix=/install -c constraints.txt -r requirements-postgres.txt; fi

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 DATABASE_PATH=/data/records.sqlite3
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app && mkdir /data && chown app:app /data
WORKDIR /app
COPY --from=api-deps /install /usr/local
COPY --chown=app:app backend/app ./app
COPY --chown=app:app data/lexicons ./data/lexicons
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-config", "/app/app/logging.json"]

FROM base AS speech-deps
COPY backend/requirements-speech.txt .
RUN if [ "$OFFLINE_BUILD" = "1" ]; then pip install --no-index --find-links=/wheelhouse --prefix=/install -c constraints.txt -r requirements-speech.txt; else pip install --find-links=/wheelhouse --prefix=/install -c constraints.txt -r requirements-speech.txt; fi

FROM runtime AS speech
COPY --from=speech-deps /install /usr/local
ARG MODEL_DIR=whisper-tiny.en
COPY --chown=app:app models/${MODEL_DIR} /models/speech
ENV WHISPER_MODEL_PATH=/models/speech WHISPER_CPU_THREADS=4 MAX_SPEECH_SESSIONS=4
CMD ["uvicorn", "app.asr:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-config", "/app/app/logging.json"]
