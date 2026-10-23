import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";
const python = path.resolve(
  "../backend/.venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.FTR_BASE_URL || "http://127.0.0.1:14173",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.resolve("../data/audio/medication.wav")}`,
      ],
    },
  },
  webServer: process.env.FTR_BASE_URL ? undefined : [
    {
      command: `"${python}" -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 18000 --no-access-log`,
      url: "http://127.0.0.1:18000/readyz",
      timeout: 60000,
      env: {
        DATABASE_PATH: path.join(
          os.tmpdir(),
          `ftr-browser-${process.pid}.sqlite3`,
        ),
        ALLOWED_ORIGINS: "http://127.0.0.1:14173",
        WHISPER_MODEL_PATH: path.resolve("../models/whisper-tiny.en"),
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        WARM_SPEECH: "1",
      },
    },
    {
      command: "npm run dev -- --port 14173",
      url: "http://127.0.0.1:14173",
      env: { API_TARGET: "http://127.0.0.1:18000" },
      timeout: 30000,
    },
  ],
});
