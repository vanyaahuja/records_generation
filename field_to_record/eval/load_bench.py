"""Real loopback HTTP latency with concurrent clients and a temporary database."""

import asyncio, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[1]


async def measure(base, path, concurrency, total=100):
    gate = asyncio.Semaphore(concurrency)
    timings = []
    server_timings = []
    async with httpx.AsyncClient(
        base_url=base,
        timeout=30,
        limits=httpx.Limits(
            max_connections=concurrency, max_keepalive_connections=concurrency
        ),
    ) as client:

        async def one():
            async with gate:
                start = time.perf_counter()
                response = await client.post(
                    path,
                    json={
                        "text": "At 14:05 gave 5 mg fictional agent X IV. At 14:07 performed bandaging."
                    },
                )
                response.raise_for_status()
                server_timings.append(
                    float(response.headers["server-timing"].split("dur=")[1])
                )
                timings.append((time.perf_counter() - start) * 1000)

        start = time.perf_counter()
        await asyncio.gather(*(one() for _ in range(total)))
        elapsed = time.perf_counter() - start
    timings.sort()
    server_timings.sort()
    return {
        "endpoint": path,
        "concurrency": concurrency,
        "requests": total,
        "requests_per_second": round(total / elapsed, 1),
        "p50_ms": round(timings[len(timings) // 2], 2),
        "p95_ms": round(timings[int(0.95 * (len(timings) - 1))], 2),
        "server_p95_ms": server_timings[int(0.95 * (len(server_timings) - 1))],
    }


async def main():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        env = {
            **os.environ,
            "DATABASE_PATH": str(Path(temp) / "load.sqlite3"),
            "WARM_SPEECH": "0",
        }
        env.pop("DB_DSN", None)
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--app-dir",
                str(ROOT / "backend"),
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--no-access-log",
            ],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            base = f"http://127.0.0.1:{port}"
            async with httpx.AsyncClient() as client:
                for _ in range(100):
                    try:
                        if (await client.get(base + "/readyz")).is_success:
                            break
                    except httpx.TransportError:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("Benchmark server did not start")
            results = []
            for endpoint in ["/v1/extract", "/api/extract"]:
                for concurrency in [1, 8, 16]:
                    results.append(await measure(base, endpoint, concurrency))
            directory = ROOT / "eval/reports"
            directory.mkdir(exist_ok=True)
            (directory / "load.json").write_text(
                json.dumps(
                    {
                        "note": "One local process, CPU, SQLite. Not a distributed load test. ASR measured separately.",
                        "results": results,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            print(json.dumps(results, indent=2))
        finally:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    asyncio.run(main())
