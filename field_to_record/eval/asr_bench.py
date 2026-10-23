"""Offline synthetic audio benchmark; writes actual transcripts, WER and RTF."""

import argparse, asyncio, io, json, os, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
GOLD = {
    "medication": "At fourteen oh five gave five milligrams of fictional agent X intravenously",
    "observations": "At fourteen ten recorded blood pressure one twenty over eighty at fourteen twelve performed bandaging",
    "negation": "No fictional agent X was administered patient refused medication",
}


def tokens(text):
    return re.findall(r"\w+", text.lower())


def wer(reference, hypothesis):
    a, b = tokens(reference), tokens(hypothesis)
    costs = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        row = [i]
        for j, y in enumerate(b, 1):
            row.append(min(row[-1] + 1, costs[j] + 1, costs[j - 1] + (x != y)))
        costs = row
    return costs[-1] / max(1, len(a))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=str(ROOT / "models/whisper-small"))
    args = parser.parse_args()
    os.environ["WHISPER_MODEL_PATH"] = str(Path(args.model).resolve())
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from app.speech import engine
    from app.extraction import extract_events

    start = time.perf_counter()
    await asyncio.to_thread(engine.load)
    warm = time.perf_counter() - start
    results = []
    for name, gold in GOLD.items():
        path = ROOT / "data/audio" / (name + ".wav")
        if not path.exists():
            continue
        result = await engine.decode(io.BytesIO(path.read_bytes()))
        results.append(
            {
                "case": name,
                "reference": gold,
                **result,
                "wer": wer(gold, result["text"]),
                "events": [e.model_dump() for e in extract_events(result["text"])],
            }
        )
    import numpy as np

    silent = await engine.decode(np.zeros(16000, dtype=np.float32))
    report = {
        "model": args.model,
        "warmup_seconds": warm,
        "synthetic_only": True,
        "word_error_note": "Literal WER penalizes digit vs spoken-number formatting. Not clinical accuracy.",
        "silence_transcript": silent["text"],
        "cases": results,
    }
    output = ROOT / "eval/reports"
    output.mkdir(exist_ok=True)
    (output / (Path(args.model).name + "-asr.json")).write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "model": args.model,
                "warmup_seconds": round(warm, 2),
                "silence_transcript": silent["text"],
                "cases": [
                    {k: r[k] for k in ["case", "text", "inference_ms", "rtf", "wer"]}
                    for r in results
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
