import hashlib, json, os, sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = os.getenv("DATABASE_PATH", "./field_to_record.sqlite3")
def connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
    return con

def init_db():
    with connect() as con:
        con.execute("CREATE TABLE IF NOT EXISTS records (record_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, responder_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL)")
        con.execute("CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, timestamp TEXT NOT NULL, payload_hash TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL)")

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def append_audit(con, record_id, action, actor, details):
    previous = con.execute("SELECT entry_hash FROM audit_events ORDER BY id DESC LIMIT 1").fetchone()
    previous_hash = previous["entry_hash"] if previous else "GENESIS"
    timestamp = datetime.now(timezone.utc).isoformat()
    payload_hash = hashlib.sha256(canonical(details).encode()).hexdigest()
    body = f"{record_id}|{action}|{actor}|{timestamp}|{payload_hash}|{previous_hash}"
    entry_hash = hashlib.sha256(body.encode()).hexdigest()
    con.execute("INSERT INTO audit_events(record_id,action,actor,timestamp,payload_hash,previous_hash,entry_hash) VALUES(?,?,?,?,?,?,?)",
        (record_id, action, actor, timestamp, payload_hash, previous_hash, entry_hash))

def save_record(record_id, case_id, responder_id, payload, actor, action="record_created"):
    now = datetime.now(timezone.utc).isoformat()
    with connect() as con:
        old = con.execute("SELECT version, created_at FROM records WHERE record_id=?", (record_id,)).fetchone()
        version = old["version"] + 1 if old else 1
        created = old["created_at"] if old else now
        con.execute("INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET case_id=excluded.case_id,responder_id=excluded.responder_id,payload=excluded.payload,updated_at=excluded.updated_at,version=excluded.version",
            (record_id, case_id, responder_id, canonical(payload), created, now, version))
        append_audit(con, record_id, action, actor, {"version": version, "payload": payload})
    return {"record_id":record_id, "version":version, "created_at":created, "updated_at":now}

def get_record(record_id):
    with connect() as con:
        row = con.execute("SELECT * FROM records WHERE record_id=?", (record_id,)).fetchone()
        if not row: return None
        audit = con.execute("SELECT id,action,actor,timestamp,payload_hash,previous_hash,entry_hash FROM audit_events WHERE record_id=? ORDER BY id", (record_id,)).fetchall()
    return {"record_id":row["record_id"], "version":row["version"], "created_at":row["created_at"],
            "updated_at":row["updated_at"], "record":json.loads(row["payload"]), "audit":[dict(a) for a in audit]}
