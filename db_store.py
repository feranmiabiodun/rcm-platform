# db_store.py
"""
Supabase/Postgres adapter for CLAIM_STORE.
"""

import os
import json
import logging
from typing import Any, Dict, Optional
import psycopg2
import psycopg2.extras
from datetime import datetime

log = logging.getLogger("db_store")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()

def _get_conn():
    if not SUPABASE_URL:
        raise RuntimeError("SUPABASE_URL is not set")
    # Connection - no autocommit; we use context manager to commit
    conn = psycopg2.connect(SUPABASE_URL)
    return conn

def _now_ts():
    return datetime.utcnow().isoformat() + "Z"

def claim_store_create(id: str, member_id: Optional[str], claim_id: Optional[str], current_stage: Optional[str], last_payload: Optional[Dict[str, Any]]):
    conn = _get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                history_entry = [{"ts": _now_ts(), "note": "created"}]
                cur.execute("""
                    INSERT INTO public.claim_store (id, member_id, claim_id, current_stage, last_payload, history)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE
                      SET member_id = EXCLUDED.member_id,
                          claim_id = EXCLUDED.claim_id,
                          current_stage = EXCLUDED.current_stage,
                          last_payload = EXCLUDED.last_payload,
                          updated_at = now(),
                          version = public.claim_store.version + 1
                    RETURNING *;
                """, (id, member_id, claim_id, current_stage, json.dumps(last_payload) if last_payload is not None else None, json.dumps(history_entry)))
                row = cur.fetchone()
                return dict(row) if row else None
    finally:
        conn.close()

def claim_store_get(id: str) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM public.claim_store WHERE id = %s;", (id,))
                row = cur.fetchone()
                return dict(row) if row else None
    finally:
        conn.close()

def claim_store_update(id: str, current_stage: Optional[str] = None, last_payload: Optional[Dict[str, Any]] = None, note: Optional[str] = None):
    conn = _get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT history FROM public.claim_store WHERE id = %s FOR UPDATE;", (id,))
                existing = cur.fetchone()
                if not existing:
                    return None
                history = existing.get("history") or []
                if note:
                    history.append({"ts": _now_ts(), "note": note, "stage": current_stage})
                cur.execute("""
                    UPDATE public.claim_store
                    SET current_stage = COALESCE(%s, current_stage),
                        last_payload = COALESCE(%s, last_payload),
                        history = %s,
                        updated_at = now(),
                        version = public.claim_store.version + 1
                    WHERE id = %s
                    RETURNING *;
                """, (current_stage, json.dumps(last_payload) if last_payload is not None else None, json.dumps(history), id))
                row = cur.fetchone()
                return dict(row) if row else None
    finally:
        conn.close()

def claim_store_resume(id: str) -> Optional[Dict[str, Any]]:
    return claim_store_get(id)
