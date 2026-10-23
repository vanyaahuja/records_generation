"""Transactional WAL storage. Immutable extraction, revision and audit tables."""

import hashlib, json, os, sqlite3, uuid
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
from functools import lru_cache
from .crypto import pack, unpack
from queue import LifoQueue


class SQLitePool:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.available = LifoQueue(maxsize=4)
        self.connections = []
        for _ in range(4):
            con = sqlite3.connect(
                path, timeout=10, isolation_level=None, check_same_thread=False
            )
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("PRAGMA busy_timeout=10000")
            self.available.put(con)
            self.connections.append(con)

    def close(self):
        for con in self.connections:
            con.close()


@lru_cache(maxsize=8)
def sqlite_pool(path):
    return SQLitePool(path)


def close_storage():
    dsn = os.getenv("DB_DSN", "")
    if dsn.startswith(("postgres://", "postgresql://")):
        postgres_pool(dsn).close()
        postgres_pool.cache_clear()
    else:
        sqlite_pool(os.getenv("DATABASE_PATH", "./field_to_record.sqlite3")).close()
        sqlite_pool.cache_clear()


class PostgresConnection:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql, params=()):
        return self.raw.execute(sql.replace("?", "%s"), params)

    def executescript(self, sql):
        return self.raw.execute(sql)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()


@lru_cache(maxsize=1)
def postgres_pool(dsn):
    from psycopg_pool import ConnectionPool
    from psycopg.rows import dict_row

    return ConnectionPool(
        dsn,
        min_size=1,
        max_size=int(os.getenv("DB_POOL_SIZE", "8")),
        kwargs={"autocommit": True, "row_factory": dict_row},
    )


@contextmanager
def acquire():
    dsn = os.getenv("DB_DSN", "")
    if dsn.startswith(("postgres://", "postgresql://")):
        with postgres_pool(dsn).connection() as raw:
            yield PostgresConnection(raw)
    else:
        path = os.getenv("DATABASE_PATH", "./field_to_record.sqlite3")
        pool = sqlite_pool(path)
        con = pool.available.get(timeout=10)
        try:
            yield con
        finally:
            if con.in_transaction:
                con.rollback()
            pool.available.put(con)


def canonical(obj):
    return json.dumps(
        obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def digest(obj):
    return hashlib.sha256(canonical(obj).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect(write=False):
    with acquire() as con:
        try:
            if write:
                con.execute(
                    "BEGIN"
                    if isinstance(con, PostgresConnection)
                    else "BEGIN IMMEDIATE"
                )
                # Serialize audit-head allocation across API replicas.
                if isinstance(con, PostgresConnection):
                    con.execute("SELECT pg_advisory_xact_lock(460031)")
            yield con
            if write:
                con.commit()
        except BaseException:
            if write:
                con.rollback()
            raise


def init_db():
    with connect() as c:
        pg = isinstance(c, PostgresConnection)
        if pg:
            c.execute('BEGIN')
            c.execute('SELECT pg_advisory_xact_lock(460031)')
        if not pg:
            c.execute("PRAGMA journal_mode=WAL")
        ddl = """
        CREATE TABLE IF NOT EXISTS extractions(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS record_heads(record_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(record_id TEXT NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, payload TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL, PRIMARY KEY(record_id,version));
        CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, timestamp TEXT NOT NULL, payload_hash TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS audit_record_idx ON audit_log(record_id,id);
        CREATE INDEX IF NOT EXISTS revision_time_idx ON revisions(created_at);
        """
        if pg:
            ddl = ddl.replace(
                "INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY"
            )
        c.executescript(ddl)
        if pg:
            c.executescript(
                "CREATE OR REPLACE FUNCTION ftr_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only table'; END $$;"
            )
        for table in ["extractions", "revisions", "audit_log"]:
            for action in ["UPDATE", "DELETE"]:
                if pg:
                    name = f"immutable_{table}_{action.lower()}"
                    c.executescript(
                        f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='{name}') THEN CREATE TRIGGER {name} BEFORE {action} ON {table} FOR EACH ROW EXECUTE FUNCTION ftr_immutable(); END IF; END $$;"
                    )
                else:
                    c.execute(
                        f"CREATE TRIGGER IF NOT EXISTS immutable_{table}_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'append-only table'); END"
                    )
        if pg: c.commit()


def store_extraction(payload):
    eid = str(uuid.uuid4())
    with connect(True) as c:
        c.execute("INSERT INTO extractions VALUES(?,?,?)", (eid, pack(payload), now()))
    return eid


def get_extraction(eid):
    with connect() as c:
        r = c.execute(
            "SELECT payload,created_at FROM extractions WHERE id=?", (eid,)
        ).fetchone()
    return {**unpack(r["payload"]), "recorded_at": r["created_at"]} if r else None


class VersionConflict(Exception):
    pass


def save_record(
    record_id,
    case_id,
    responder_id,
    payload,
    actor,
    action="record_created",
    expected_version=None,
):
    timestamp = now()
    with connect(True) as c:
        old = c.execute(
            "SELECT version FROM record_heads WHERE record_id=?", (record_id,)
        ).fetchone()
        version = old["version"] if old else 0
        if version and expected_version != version:
            raise VersionConflict(
                "Record changed; reopen the latest revision before saving."
            )
        if not version and expected_version is not None:
            raise VersionConflict("Record does not exist.")
        payload["updated_at"] = timestamp
        c.execute(
            "INSERT INTO revisions VALUES(?,?,?,?,?,?)",
            (
                record_id,
                version + 1,
                version or None,
                pack(payload),
                timestamp,
                actor,
            ),
        )
        c.execute(
            "INSERT INTO record_heads VALUES(?,?) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version",
            (record_id, version + 1),
        )
        previous = c.execute(
            "SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        entry = {
            "record_id": record_id,
            "version": version + 1,
            "action": action,
            "actor": actor,
            "timestamp": timestamp,
            "payload_hash": digest(payload),
            "previous_hash": previous["entry_hash"] if previous else "GENESIS",
        }
        c.execute(
            "INSERT INTO audit_log(record_id,version,action,actor,timestamp,payload_hash,previous_hash,entry_hash) VALUES(?,?,?,?,?,?,?,?)",
            (*entry.values(), digest(entry)),
        )
    return {
        "record_id": record_id,
        "version": version + 1,
        "created_at": payload["recorded_at"],
        "updated_at": timestamp,
    }


def get_record(record_id, version=None):
    with connect() as c:
        if version is None:
            head = c.execute(
                "SELECT version FROM record_heads WHERE record_id=?", (record_id,)
            ).fetchone()
            if not head:
                return None
            version = head["version"]
        row = c.execute(
            "SELECT * FROM revisions WHERE record_id=? AND version=?",
            (record_id, version),
        ).fetchone()
        if not row:
            return None
        audit = c.execute(
            "SELECT * FROM audit_log WHERE record_id=? AND version<=? ORDER BY id",
            (record_id, version),
        ).fetchall()
        history = c.execute(
            "SELECT version,parent_version,created_at,actor FROM revisions WHERE record_id=? ORDER BY version",
            (record_id,),
        ).fetchall()
    payload = unpack(row["payload"])
    return {
        "record_id": record_id,
        "version": version,
        "created_at": payload["recorded_at"],
        "updated_at": row["created_at"],
        "record": payload,
        "audit": [dict(a) for a in audit],
        "revisions": [dict(r) for r in history],
    }


def list_records(query="", limit=50):
    with connect() as c:
        rows = c.execute(
            "SELECT r.record_id,r.version,r.created_at,r.payload FROM revisions r JOIN record_heads h ON r.record_id=h.record_id AND r.version=h.version ORDER BY r.created_at DESC LIMIT 1000"
        ).fetchall()
    output = []
    for r in rows:
        p = unpack(r["payload"])
        if (
            query.lower()
            not in (
                p["case_id"] + " " + p["responder_id"] + " " + r["record_id"]
            ).lower()
        ):
            continue
        output.append(
            {
                "record_id": r["record_id"],
                "version": r["version"],
                "created_at": r["created_at"],
                "case_id": p["case_id"],
                "record_status": p["record_status"],
                "event_count": len(p["events"]),
            }
        )
        if len(output) >= limit:
            break
    return output


def verify_audit():
    previous = "GENESIS"
    count = 0
    error = None
    with connect() as c:
        c.execute(
            "BEGIN ISOLATION LEVEL REPEATABLE READ"
            if isinstance(c, PostgresConnection)
            else "BEGIN"
        )
        for row in c.execute("SELECT * FROM audit_log ORDER BY id"):
            entry = {
                k: row[k]
                for k in [
                    "record_id",
                    "version",
                    "action",
                    "actor",
                    "timestamp",
                    "payload_hash",
                    "previous_hash",
                ]
            }
            payload = c.execute(
                "SELECT payload FROM revisions WHERE record_id=? AND version=?",
                (row["record_id"], row["version"]),
            ).fetchone()
            source = None
            try:
                if payload:
                    source_id = unpack(payload["payload"]).get("extraction_id")
                    source = c.execute(
                        "SELECT payload,created_at FROM extractions WHERE id=?",
                        (source_id,),
                    ).fetchone()
                source_valid = bool(source) and digest(
                    {**unpack(source["payload"]), "recorded_at": source["created_at"]}
                ) == unpack(payload["payload"]).get("extraction_hash")
            except (ValueError, TypeError, AttributeError):
                error = {
                    "entry_id": row["id"],
                    "reason": "Malformed revision or extraction payload",
                }
                break
            if (
                row["previous_hash"] != previous
                or digest(entry) != row["entry_hash"]
                or not payload
                or digest(unpack(payload["payload"])) != row["payload_hash"]
                or not source_valid
            ):
                error = {"entry_id": row["id"], "reason": "Hash or revision mismatch"}
                break
            previous = row["entry_hash"]
            count += 1
        revisions = c.execute("SELECT count(*) AS count FROM revisions").fetchone()[
            "count"
        ]
        broken_heads = c.execute(
            "SELECT count(*) AS count FROM record_heads h WHERE h.version != (SELECT max(r.version) FROM revisions r WHERE r.record_id=h.record_id)"
        ).fetchone()["count"]
        missing_heads = c.execute(
            "SELECT count(*) AS count FROM (SELECT DISTINCT record_id FROM revisions) r LEFT JOIN record_heads h ON r.record_id=h.record_id WHERE h.record_id IS NULL"
        ).fetchone()["count"]
        if not error and (revisions != count or broken_heads or missing_heads):
            error = {"reason": "Missing audit entries or invalid record head"}
    return {
        "valid": error is None,
        "entries_verified": count,
        "head_hash": previous,
        "error": error,
        "limitation": "A privileged database rewrite can recompute this chain. No external trust anchor.",
    }
