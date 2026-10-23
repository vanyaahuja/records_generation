"""Provision models before going offline; never called by application runtime."""

import argparse, os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument(
    "name", choices=["tiny.en", "base.en", "small.en"], default="base.en", nargs="?"
)
args = parser.parse_args()
os.environ["HF_HUB_OFFLINE"] = "0"
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parents[1]
path = snapshot_download(
    "Systran/faster-whisper-" + args.name,
    local_dir=root / "models" / ("whisper-" + args.name),
    allow_patterns=["model.bin", "config.json", "tokenizer.json", "vocabulary.*"],
)
print(path)
