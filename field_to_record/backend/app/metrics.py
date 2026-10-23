"""ASGI instrumentation without task/stream allocation per request."""

import json, logging, time, uuid

logger = logging.getLogger("field-to-record")


class MetricsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        start = time.perf_counter()
        request_id = str(uuid.uuid4())

        async def measured(message):
            if message["type"] == "http.response.start":
                elapsed = round((time.perf_counter() - start) * 1000, 2)
                message.setdefault("headers", []).extend(
                    [
                        (b"server-timing", f"total;dur={elapsed}".encode()),
                        (b"x-request-id", request_id.encode()),
                        (b"cache-control", b"no-store"),
                    ]
                )
                route = scope.get("route")
                logger.info(
                    json.dumps(
                        {
                            "request_id": request_id,
                            "method": scope["method"],
                            "route": route.path if route else "unknown",
                            "status": message["status"],
                            "latency_ms": elapsed,
                        }
                    )
                )
            await send(message)

        await self.app(scope, receive, measured)
