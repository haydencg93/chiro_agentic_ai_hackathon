import json
import sqlite3
from pathlib import Path

class Ledger:
    persistence = "local_sqlite_test_fallback"
    """Explicit local/test fallback; never sends outreach or modifies patient data."""
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS cases (patient_id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    def connect(self):
        return sqlite3.connect(self.path, timeout=10)
    def get(self, patient_id):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM cases WHERE patient_id=?', (patient_id,)).fetchone()
        return json.loads(row[0]) if row else None
    def save(self, case):
        with self.connect() as db:
            db.execute('INSERT INTO cases VALUES (?,?) ON CONFLICT(patient_id) DO UPDATE SET payload=excluded.payload',
                       (case['patient']['patient_id'], json.dumps(case)))
    def all(self):
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute('SELECT payload FROM cases')]
