import json, logging
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record):
        message = record.getMessage()
        try:
            payload = json.loads(message)
        except (ValueError, TypeError):
            payload = {"message": message}
        if not isinstance(payload, dict):
            payload = {"message": message}
        return json.dumps(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                **payload,
            }
        )
