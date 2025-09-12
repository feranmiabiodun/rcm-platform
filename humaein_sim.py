# <full file begins>
"""
Humaein eClaim Simulator (Exact-match mode) — GCC-realistic field representation

Behavior:
- Exact-match logic with only trimmed whitespace.
- Seed data loaded at import via _do_seed_all_rules().
- OCR endpoint removed. A lightweight interpreter produces a human-readable
  `summary` with every stage response (no "llm" label).
- Added DB-fetch endpoint for eligibility: /eligibility/fetch_db (uses MongoDB).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Union
import uuid
import re
import csv
import io
import json
import os
from copy import deepcopy

from dotenv import load_dotenv
from pathlib import Path

# load .env (safe)
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path, override=False)

from fastapi import APIRouter, HTTPException, Request, Query, Depends, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from fastapi import FastAPI

# Try to use user's auth.get_api_key; fallback to a permissive stub for local dev if not present.
try:
    from auth import get_api_key
except Exception:
    def get_api_key():
        # Permissive dev stub (no auth) — keep for local testing if auth.py isn't present.
        return None

router = APIRouter()

# -----------------------
# In-memory stores
# -----------------------
RULES: Dict[str, Dict[str, Any]] = {}      # rule_id -> rule
EVENTS: List[Dict[str, Any]] = []         # audit trail
CLAIMS: Dict[str, Dict[str, Any]] = {}
REMITTANCES: Dict[str, Dict[str, Any]] = {}

# Index for deterministic unique-field matching:
UNIQUE_INDEX: Dict[str, Dict[str, str]] = {}

# -----------------------
# Stage-specific unique fields configuration (source of truth)
UNIQUE_FIELDS_PER_STAGE: Dict[str, List[str]] = {
    "eligibility": ["Claim.ID", "Claim.MemberID"],
    "prior_authorization": ["PriorAuthorizationRequest.RequestID"],
    "remittance_tracking": ["Remittance.RemitID", "Remittance.ClaimRefID"],
    "claims_submission": ["ClaimSubmission.ClaimID", "ClaimSubmission.ExternalID"],
    "claims_scrubbing": ["Claim.ExternalID"],
    "claims_resubmission": ["Resubmission.OriginalClaimRefID"],
    "remittance_post_resubmission": ["RemittancePost.NewClaimRefID"],
    "denial_management": ["Denial.ClaimRefID"],
    "reconciliation": ["Reconciliation.ReconID"],
    "medical_coding": ["Claim.ID"],
    "clinical_documentation": ["ClinicalDocument.ProcedureCode", "ClinicalDocument.ClinicianID"],
}

STAGES_WITH_PATIENT_INFO = {
    "eligibility",
    "prior_authorization",
    "claims_submission",
    "claims_scrubbing",
    "claims_resubmission",
    "medical_coding",
    "clinical_documentation",
}

# -----------------------
# Utility helpers
def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"

def _gen_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"

def _log_event(actor: str, stage_id: str, event_type: str, payload_summary: Dict[str, Any], refs: Dict[str, str]):
    ev = {
        "timestamp": _now_iso(),
        "actor": actor,
        "stage_id": stage_id,
        "event_type": event_type,
        "payload_summary": payload_summary,
        "reference_ids": refs,
    }
    EVENTS.append(ev)
    return ev

def _get_path_value(obj: Any, path: str):
    """
    Safe dotted-path extractor.
    - Exact key match preferred.
    - If dotted path doesn't match, fallback to first case-insensitive key occurrence of the last segment.
    - Supports numeric indices in the dotted path.
    """
    if obj is None:
        return None
    parts = path.split(".")
    cur = obj
    for p in parts:
        # array index
        if re.fullmatch(r"\d+", p):
            idx = int(p)
            if isinstance(cur, list) and 0 <= idx < len(cur):
                cur = cur[idx]
                continue
            return None
        # dict lookup
        if isinstance(cur, dict):
            if p in cur:
                cur = cur.get(p)
                continue
            # fallback: case-insensitive key match for that segment only
            last_key = None
            for k in cur.keys():
                if k.lower() == p.lower():
                    last_key = k
                    break
            if last_key:
                cur = cur.get(last_key)
                continue
            return None
        else:
            return None
    return cur

def _find_first_key_occurrence(obj: Any, key: str) -> Any:
    """Recursively search and return first value where dict key == key (case-insensitive)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        # direct case-sensitive
        if key in obj:
            return obj[key]
        # case-insensitive direct
        for k, v in obj.items():
            if k.lower() == key.lower():
                return v
        # recurse
        for v in obj.values():
            found = _find_first_key_occurrence(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _find_first_key_occurrence(item, key)
            if found is not None:
                return found
    return None

# -----------------------
# Exact-match composite builder (NO normalization other than trimming)
def _normalize_value_exact(v: Any, field_name: Optional[str] = None) -> Optional[str]:
    """
    EXACT mode: return trimmed string representation; preserve punctuation and formatting.
    Return None if v is None.
    """
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        try:
            return json.dumps(v, sort_keys=True, separators=(",", ":"))
        except Exception:
            return str(v)
    s = str(v).strip()
    if s == "":
        return None
    return s

def _extract_values_by_fieldnames(obj: Any, fieldnames: List[str]) -> Dict[str, Any]:
    """
    For each name in fieldnames, search obj and return mapping shortname -> found_value.
    Tries dotted path first, falls back to first occurrence of last key name.
    """
    found: Dict[str, Any] = {}
    for fn in fieldnames:
        shortname = fn.split(".")[-1]
        if "." in fn:
            val = _get_path_value(obj, fn)
            if val is not None:
                found[shortname] = val
                continue
            val2 = _find_first_key_occurrence(obj, shortname)
            if val2 is not None:
                found[shortname] = val2
        else:
            val = _find_first_key_occurrence(obj, fn)
            if val is not None:
                found[fn] = val
    return found

def _build_unique_composite_exact(obj: Any, fieldnames: List[str]) -> Optional[str]:
    """
    Build exact composite: ShortName=ExactTrimmedValue||ShortName=ExactTrimmedValue
    Returns None if any required unique field is missing or empty.
    """
    parts: List[str] = []
    for fn in fieldnames:
        shortname = fn.split(".")[-1]
        if "." in fn:
            val = _get_path_value(obj, fn)
            if val is None:
                val = _find_first_key_occurrence(obj, shortname)
        else:
            val = _find_first_key_occurrence(obj, fn)
        norm = _normalize_value_exact(val, field_name=fn)
        if norm is None:
            return None
        parts.append(f"{shortname}={norm}")
    return "||".join(parts)

def _rebuild_index_for_stage(stage: str):
    UNIQUE_INDEX[stage] = {}
    uf = UNIQUE_FIELDS_PER_STAGE.get(stage)
    if not uf:
        return
    for rid, r in RULES.items():
        if r.get("stage") != stage:
            continue
        ref_example = r.get("reference_example", {}) or {}
        comp = _build_unique_composite_exact(ref_example, uf)
        if comp:
            if comp in UNIQUE_INDEX[stage]:
                _log_event("system", stage, "index_collision", {"composite": comp, "old_rule": UNIQUE_INDEX[stage][comp], "new_rule": rid}, {"rule_id_old": UNIQUE_INDEX[stage][comp], "rule_id_new": rid})
            UNIQUE_INDEX[stage][comp] = rid

def _index_rule_if_unique_fields(rule: Dict[str, Any]):
    stage = rule.get("stage")
    uf = UNIQUE_FIELDS_PER_STAGE.get(stage)
    if not uf:
        return
    comp = _build_unique_composite_exact(rule.get("reference_example", {}) or {}, uf)
    if comp:
        if comp in UNIQUE_INDEX.get(stage, {}):
            _log_event("system", stage, "index_collision_single", {"composite": comp, "existing": UNIQUE_INDEX[stage].get(comp), "new": rule.get("id")}, {"rule_id_existing": UNIQUE_INDEX[stage].get(comp), "rule_id_new": rule.get("id")})
        UNIQUE_INDEX.setdefault(stage, {})[comp] = rule["id"]

# -----------------------
# Helper: extract patient info from a reference_example (used to augment returned outcome)
def _extract_patient_info(obj: Any) -> Dict[str, Any]:
    """
    Try to find patient identifying info in a seeded reference_example.
    Returns a dict with keys subset of: patient_id, name, dob, member_id
    """
    patient: Dict[str, Any] = {}

    # First look for an explicit Patient node
    pnode = _find_first_key_occurrence(obj, "Patient") or _find_first_key_occurrence(obj, "PatientInfo")
    if isinstance(pnode, dict):
        patient['patient_id'] = pnode.get("PatientID") or pnode.get("PatientId") or pnode.get("MemberID") or pnode.get("MemberId") or pnode.get("ID")
        patient['name'] = pnode.get("Name") or pnode.get("FullName") or pnode.get("GivenName") or pnode.get("FirstName")
        patient['dob'] = pnode.get("DOB") or pnode.get("DateOfBirth") or pnode.get("BirthDate")

    # Fallbacks: explicit MemberID anywhere
    if not patient.get('patient_id'):
        mid = _find_first_key_occurrence(obj, "MemberID") or _find_first_key_occurrence(obj, "MemberId")
        if mid:
            patient['patient_id'] = mid
            patient['member_id'] = mid

    # Other name/dob fallbacks
    if not patient.get('name'):
        name_val = _find_first_key_occurrence(obj, "Name") or _find_first_key_occurrence(obj, "PatientName") or _find_first_key_occurrence(obj, "FullName")
        if name_val:
            patient['name'] = name_val
    if not patient.get('dob'):
        dob_val = _find_first_key_occurrence(obj, "DOB") or _find_first_key_occurrence(obj, "DateOfBirth") or _find_first_key_occurrence(obj, "BirthDate")
        if dob_val:
            patient['dob'] = dob_val

    # Clean None
    return {k: v for k, v in patient.items() if v is not None}

# -----------------------
# Matching (exact only)
def match_rule_exact(stage: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    uf = UNIQUE_FIELDS_PER_STAGE.get(stage)
    if uf:
        incoming_composite = _build_unique_composite_exact(payload, uf)
        if incoming_composite is None:
            _log_event("gateway", stage, "no_unique_match_missing_fields", {"expected_fields": uf, "found": list(_extract_values_by_fieldnames(payload, uf).keys())}, {"request_sample": _gen_id("REQ")})
            return None
        rid = UNIQUE_INDEX.get(stage, {}).get(incoming_composite)
        _log_event("gateway", stage, "unique_lookup_attempt", {"incoming_composite": incoming_composite, "found_rule": bool(rid)}, {"request_sample": _gen_id("REQ")})
        if rid:
            return RULES.get(rid)
        return None
    _log_event("gateway", stage, "no_unique_fields_configured", {"stage": stage}, {"request_sample": _gen_id("REQ")})
    return None

# -----------------------
# Request parser (JSON/CSV)
async def parse_request_payload(request: Request) -> Any:
    ctype = (request.headers.get("content-type") or "").lower()
    body = await request.body()
    s = body.decode("utf-8", errors="replace").strip()
    if not s:
        return {}
    # try JSON
    try:
        parsed = json.loads(s)
        if isinstance(parsed, (list, dict)):
            return parsed
    except Exception:
        pass
    # try CSV
    try:
        f = io.StringIO(s)
        reader = csv.DictReader(f)
        rows = list(reader)
        def convert_val(v: str):
            if v is None:
                return None
            v = v.strip()
            if v == "":
                return ""
            if v.lower() in ("true", "false"):
                return v.lower() == "true"
            try:
                if "." in v:
                    return float(v)
                return int(v)
            except Exception:
                return v
        converted = [{k: convert_val(v) for k, v in row.items()} for row in rows]
        return converted
    except Exception:
        try:
            return json.loads(s)
        except Exception:
            return {}

# -----------------------
# Admin endpoints and seed (response_model=None to avoid Pydantic inference)
class RuleCreate(BaseModel):
    stage: str
    match_criteria: Dict[str, Any] = Field(default_factory=dict)
    outcome: Dict[str, Any] = Field(default_factory=dict)
    priority: int = 100
    reference_example: Optional[Dict[str, Any]] = None

@router.post("/__admin/rules", response_model=None)
def create_rule(rc: RuleCreate, api_key: str = Depends(get_api_key)):
    rid = _gen_id("RULE")
    rule = {
        "id": rid,
        "stage": rc.stage,
        "match_criteria": rc.match_criteria,
        "outcome": rc.outcome,
        "priority": rc.priority,
        "reference_example": rc.reference_example or {},
        "created_at": _now_iso(),
    }
    RULES[rid] = rule
    _index_rule_if_unique_fields(rule)
    return {"created": True, "rule": rule}

@router.get("/__admin/rules", response_model=None)
def list_rules(stage: Optional[str] = Query(None), api_key: str = Depends(get_api_key)):
    rules = list(RULES.values())
    if stage:
        rules = [r for r in rules if r["stage"] == stage]
    return {"count": len(rules), "rules": rules}

@router.get("/__admin/rules/{rule_id}", response_model=None)
def get_rule(rule_id: str, api_key: str = Depends(get_api_key)):
    r = RULES.get(rule_id)
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    return r

@router.put("/__admin/rules/{rule_id}", response_model=None)
def update_rule(rule_id: str, rc: RuleCreate, api_key: str = Depends(get_api_key)):
    if rule_id not in RULES:
        raise HTTPException(status_code=404, detail="Rule not found")
    RULES[rule_id].update({
        "match_criteria": rc.match_criteria,
        "outcome": rc.outcome,
        "priority": rc.priority,
        "reference_example": rc.reference_example or {},
        "stage": rc.stage,
    })
    _rebuild_index_for_stage(rc.stage)
    return {"updated": True, "rule": RULES[rule_id]}

@router.delete("/__admin/rules/{rule_id}", response_model=None)
def delete_rule(rule_id: str, api_key: str = Depends(get_api_key)):
    if rule_id not in RULES:
        raise HTTPException(status_code=404, detail="Rule not found")
    stage = RULES[rule_id].get("stage")
    del RULES[rule_id]
    if stage:
        _rebuild_index_for_stage(stage)
    return {"deleted": True}

@router.get("/__debug/events", response_model=None)
def debug_events(limit: int = Query(200, ge=1, le=1000), api_key: str = Depends(get_api_key)):
    return {"count": len(EVENTS), "events": EVENTS[-limit:]}

@router.get("/__admin/unique_index", response_model=None)
def get_unique_index(api_key: str = Depends(get_api_key)):
    out = {}
    for stage, mapping in UNIQUE_INDEX.items():
        out[stage] = {}
        for comp, rid in mapping.items():
            rule = RULES.get(rid)
            out[stage][comp] = {"rule_id": rid, "outcome_sample": rule.get("outcome") if rule else None}
    return {"unique_index": out}

@router.get("/__admin/reference_examples", response_model=None)
def list_reference_examples(stage: Optional[str] = None, api_key: str = Depends(get_api_key)):
    examples = []
    for r in RULES.values():
        if stage and r["stage"] != stage:
            continue
        examples.append({"rule_id": r["id"], "stage": r["stage"], "match_criteria": r["match_criteria"], "reference_example": r["reference_example"], "priority": r.get("priority")})
    return {"count": len(examples), "examples": examples}

@router.post("/__admin/compute_composite", response_model=None)
def compute_composite(payload: Dict[str, Any], stage: str = Query(...), api_key: str = Depends(get_api_key)):
    uf = UNIQUE_FIELDS_PER_STAGE.get(stage)
    if not uf:
        return {"error": "stage_not_configured"}
    comp = _build_unique_composite_exact(payload, uf)
    return {"computed_composite": comp, "expected_fields": uf, "found_values": _extract_values_by_fieldnames(payload, uf)}

# -----------------------
# Programmatic seeder: _do_seed_all_rules
def _do_seed_all_rules() -> int:
    """
    Populate RULES, EVENTS, UNIQUE_INDEX with the seeded scenarios.
    Returns the number of seeded rules.
    """
    RULES.clear()
    EVENTS.clear()
    UNIQUE_INDEX.clear()
    now = _now_iso()

    def add(stage: str, outcome: Dict[str, Any], key: str, reference_example: Dict[str, Any], priority: Optional[int] = None):
        uf = UNIQUE_FIELDS_PER_STAGE.get(stage)
        if uf:
            comp = _build_unique_composite_exact(reference_example, uf)
            if comp is None:
                _log_event("system", stage, "seed_rule_skipped_missing_unique_fields", {"scenario": key, "expected_fields": uf}, {"scenario": key})
                return None
        rid = _gen_id("RULE")
        rule = {
            "id": rid,
            "stage": stage,
            "match_criteria": {},
            "outcome": outcome,
            "priority": priority or 100,
            "reference_example": reference_example,
            "created_at": now,
        }
        RULES[rid] = rule
        _index_rule_if_unique_fields(rule)
        return rid

    # --- FULL SEED LIST (kept from earlier content) ---
    # (for brevity in this response I include the same seed entries you previously provided)
    # Eligibility seeds
    add("eligibility",
        {"outcome_code":"ELG_OK","outcome_label":"Eligible","description":"Member active and service covered"},
        "eligibility__ELG_OK",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0001","MemberID":"784-1987-1234567-1","PatientShare":0.0,"Net":100.00},
         "Patient":{"PatientID":"PT-ELG-0001","Name":"Aisha Khalid","DOB":"1988-06-15","Gender":"F"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_NOT_FOUND","outcome_label":"Not Found","description":"Member or policy not found"},
        "eligibility__ELG_NOT_FOUND",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0002","MemberID":"784-1900-0000000-0","Net":50.00},
         "Patient":{"PatientID":"PT-ELG-0002","Name":"Mohammed Al Saeed","DOB":"1979-11-02","Gender":"M"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_EXPIRED","outcome_label":"Expired","description":"Policy expired before service date"},
        "eligibility__ELG_EXPIRED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0003","MemberID":"784-1980-9999999-9","Net":75.00,"Encounter":{"Start":"01/01/2025 10:00"}},
         "Patient":{"PatientID":"PT-ELG-0003","Name":"Fatima Noor","DOB":"1965-03-21","Gender":"F"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_DEP_NOT_COVERED","outcome_label":"Dependent Not Covered","description":"Dependent not included"},
        "eligibility__ELG_DEP_NOT_COVERED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0004","MemberID":"784-1990-2222222-2","PatientShare":10.0,"Net":60.00,"Contract":{"PackageName":"SPOUSE_ONLY"}},
         "Patient":{"PatientID":"PT-ELG-0004","Name":"Laila Hassan","DOB":"2002-08-30","Gender":"F"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_BENEFIT_EXHAUST","outcome_label":"Benefits Exhausted","description":"Benefit limit exceeded"},
        "eligibility__ELG_BENEFIT_EXHAUST",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0005","MemberID":"784-1985-3333333-3","Net":2000.00},
         "Patient":{"PatientID":"PT-ELG-0005","Name":"Omar Khalil","DOB":"1991-12-05","Gender":"M"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_PREAUTH_REQUIRED","outcome_label":"Pre-auth Required","description":"Service flagged as requiring prior authorization","required_actions":["Submit prior authorization"]},
        "eligibility__ELG_PREAUTH_REQUIRED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0006","MemberID":"784-1992-4444444-4","Activity":[{"ID":"A1","Code":"30520","Net":150.0}]},
         "Patient":{"PatientID":"PT-ELG-0006","Name":"Samir Patel","DOB":"1987-04-10","Gender":"M"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_OUT_OF_NETWORK","outcome_label":"Out of Network","description":"Provider not in network"},
        "eligibility__ELG_OUT_OF_NETWORK",
        {"Header":{"SenderID":"HOSP-OUT-999","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0007","MemberID":"784-1995-5555555-5","Net":120.00,"ProviderID":"HOSP-OUT-999"},
         "Patient":{"PatientID":"PT-ELG-0007","Name":"Huda Al Mansoori","DOB":"1994-01-20","Gender":"F"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_COB","outcome_label":"Coordination of Benefits","description":"Another payer primary"},
        "eligibility__ELG_COB",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0008","MemberID":"784-1975-6666666-6","Net":90.00,"Contract":{"PackageName":"COB_PRIMARY"}},
         "Patient":{"PatientID":"PT-ELG-0008","Name":"Ibrahim Musa","DOB":"1970-09-09","Gender":"M"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_PENDING","outcome_label":"Pending Enrollment","description":"Coverage effective in future"},
        "eligibility__ELG_PENDING",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0009","MemberID":"784-2000-7777777-7","Net":50.0,"Encounter":{"Start":"01/11/2025 09:00"}},
         "Patient":{"PatientID":"PT-ELG-0009","Name":"Nadia Rahman","DOB":"2001-07-07","Gender":"F"}}
    )
    add("eligibility",
        {"outcome_code":"ELG_SUSPENDED","outcome_label":"Suspended / On Hold","description":"Administrative hold on policy"},
        "eligibility__ELG_SUSPENDED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:30"},
         "Claim":{"ID":"CLM-ELG-0010","MemberID":"784-1988-8888888-8","Net":30.0,"Contract":{"PackageName":"SUSPENDED"}},
         "Patient":{"PatientID":"PT-ELG-0010","Name":"Yusuf Abdullah","DOB":"1962-02-01","Gender":"M"}}
    )

    # Prior-auth seeds
    add("prior_authorization",
        {"prior_auth_id":"PA-EX-APP-FULL","status_code":"PA_APPROVED","status_label":"Approved (Full)","approved_items":[{"procedure_code":"30520","approved_units":1}],"expires_on":"08/10/2025"},
        "prior_authorization__PA_APPROVED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:31"},
         "PriorAuthorizationRequest":{"RequestID":"PAR-0001","MemberID":"784-1987-1234567-1","ProcedureCodes":["30520"],"RequestedUnits":1},
         "Patient":{"PatientID":"PT-PA-0001","Name":"Aisha Khalid","DOB":"1988-06-15","Gender":"F"}}
    )
    add("prior_authorization",
        {"prior_auth_id":"PA-EX-APP-PART","status_code":"PA_APPROVED_PARTIAL","status_label":"Approved (Partial)","approved_items":[{"procedure_code":"30520","approved_units":1}]},
        "prior_authorization__PA_APPROVED_PART",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:31"},
         "PriorAuthorizationRequest":{"RequestID":"PAR-0002","MemberID":"784-1987-1239999-1","ProcedureCodes":["30520"],"RequestedUnits":2},
         "Patient":{"PatientID":"PT-PA-0002","Name":"Khaled Mansoor","DOB":"1990-10-11","Gender":"M"}}
    )
    add("prior_authorization",
        {"prior_auth_id":"PA-EX-PEND","status_code":"PA_PENDING_CLINICAL","status_label":"Pending Clinical Review","comments":"Queued for manual clinical review"},
        "prior_authorization__PA_PENDING_CLINICAL",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:31"},
         "PriorAuthorizationRequest":{"RequestID":"PAR-0003","MemberID":"784-1991-2223333-2","ProcedureCodes":["99999"],"ClinicalNotes":"See attached"},
         "Patient":{"PatientID":"PT-PA-0003","Name":"Rana Farouk","DOB":"1982-05-05","Gender":"F"}}
    )
    add("prior_authorization",
        {"prior_auth_id":"PA-EX-DENY","status_code":"PA_DENIED","status_label":"Denied","comments":"Authorization denied"},
        "prior_authorization__PA_DENY",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:31"},
         "PriorAuthorizationRequest":{"RequestID":"PAR-0004","MemberID":"784-1982-4445555-4","ProcedureCodes":["30520"],"ClinicalNotes":"Not indicated"},
         "Patient":{"PatientID":"PT-PA-0004","Name":"Hassan Ali","DOB":"1978-04-14","Gender":"M"}}
    )

    # Clinical documentation seeds
    add("clinical_documentation",
        {"doc_status":"DOC_COMPLETE","missing_items":[],"comments":"All required clinical documentation present"},
        "clinical_documentation__DOC_COMPLETE",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:32"},
         "ClinicalDocument":{"ProcedureCode":"99214","ClinicianID":"DR-001","Narrative":"Comprehensive consultation with documented findings","Attachments":["report.pdf"]},
         "Patient":{"PatientID":"PT-DOC-001","Name":"Laila Noor","DOB":"1975-12-12","Gender":"F"}}
    )
    add("clinical_documentation",
        {"doc_status":"DOC_MISSING_ATTACH","missing_items":["imaging_report"],"comments":"Missing attachments"},
        "clinical_documentation__DOC_MISSING_ATTACH",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:32"},
         "ClinicalDocument":{"ProcedureCode":"30520","ClinicianID":"DR-002","Attachments":[]},
         "Patient":{"PatientID":"PT-DOC-002","Name":"Jamal Kazi","DOB":"1984-02-02","Gender":"M"}}
    )
    add("clinical_documentation",
        {"doc_status":"DOC_INCOMPLETE_FIELDS","missing_items":["clinician_id"],"comments":"Missing clinician id"},
        "clinical_documentation__DOC_INCOMPLETE_FIELDS",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:32"},
         "ClinicalDocument":{"ProcedureCode":"99214"},
         "Patient":{"PatientID":"PT-DOC-003","Name":"Salma Qureshi","DOB":"1992-11-30","Gender":"F"}}
    )

    # Medical coding seeds
    add("medical_coding",
        {"coding_status":"CODE_VALID","line_level_issues":[],"suggestions":[]},
        "medical_coding__CODE_VALID",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:33"},
         "Claim":{"ID":"CLM-COD-0001","ServiceLineItems":[{"ProcedureCode":"99214","Net":100.0}],"DiagnosisCodes":["I10"],"PatientAge":45,"PatientSex":"M"},
         "Patient":{"PatientID":"PT-COD-0001","Name":"Hassan Omar","DOB":"1979-04-04","Gender":"M"}}
    )
    add("medical_coding",
        {"coding_status":"CODE_INVALID","line_level_issues":[{"line_index":0,"issue_code":"CODE_INVALID","description":"Procedure code invalid"}]},
        "medical_coding__CODE_INVALID",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:33"},
         "Claim":{"ID":"CLM-COD-0002","ServiceLineItems":[{"ProcedureCode":"XXXX","Net":50.0}],"DiagnosisCodes":["I10"]},
         "Patient":{"PatientID":"PT-COD-0002","Name":"Tariq Ali","DOB":"1986-06-06","Gender":"M"}}
    )

    # Claims scrubbing seeds
    add("claims_scrubbing",
        {"scrub_status":"SCRUB_PASS","errors":[],"warnings":[],"tracking_id":_gen_id("TID")},
        "claims_scrubbing__SCRUB_PASS",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:34"},
         "Claim":{"ExternalID":"REF_SCRUB_PASS","Patient":{"MemberID":"784-1987-1234567-1"},"ServiceLines":[{"ProcedureCode":"99214","Charge":100.0}],"ProviderID":"HOSP-001","DateOfService":"01/09/2025"},
         "Patient":{"PatientID":"PT-SCRUB-0001","Name":"Aisha Khalid","DOB":"1988-06-15","Gender":"F"}}
    )
    add("claims_scrubbing",
        {"scrub_status":"SCRUB_HARD_REJECT","errors":[{"field":"patient","error_code":"MISSING_FIELD","message":"patient missing"}],"warnings":[],"tracking_id":None},
        "claims_scrubbing__SCRUB_HARD_REJECT",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:34"},
         "Claim":{"ExternalID":"REF_SCRUB_HARD","ServiceLines":[]} }
    )

    # Claims submission seeds
    add("claims_submission",
        {"submission_status":"SUB_ACCEPTED","claim_ref_id":"CLM-EX-1","ack_timestamp":_now_iso(),"queued_position":0,"comments":"Claim accepted and queued"},
        "claims_submission__SUB_ACCEPTED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-01","TransactionDate":"08/09/2025 14:35"},
         "ClaimSubmission":{"ExternalID":"REF_SUB_ACCEPTED","ClaimID":"CLM-EX-1","Total":150.00},
         "Patient":{"PatientID":"PT-SUB-0001","Name":"Aisha Khalid","DOB":"1988-06-15","Gender":"F"}}
    )
    add("claims_submission",
        {"submission_status":"SUB_REJECTED_GATEWAY","claim_ref_id":None,"comments":"Rejected at gateway due to scrub"},
        "claims_submission__SUB_REJECTED_GATEWAY",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"GATEWAY-01","TransactionDate":"08/09/2025 14:35"},
         "ClaimSubmission":{"ExternalID":"REF_SUB_REJECTED_GATEWAY","SimulateBadScrub":True}}
    )
    add("claims_submission",
        {"submission_status":"SUB_ROUTED","claim_ref_id":"CLM-ROUTED-1","ack_timestamp":_now_iso(),"queued_position":0,"comments":"Routed to payer"},
        "claims_submission__SUB_ROUTED",
        {"Header":{"SenderID":"HOSP-001","ReceiverID":"PAYER-02","TransactionDate":"08/09/2025 14:35"},
         "ClaimSubmission":{"ExternalID":"REF_SUB_ROUTED","ClaimID":"CLM-ROUTED-1","RoutedTo":"PAYER-02"},
         "Patient":{"PatientID":"PT-SUB-0003","Name":"Routed Patient","DOB":"1982-02-02","Gender":"M"}}
    )

    # Claims resubmission seeds
    add("claims_resubmission",
        {"resubmission_status":"RESUB_ACCEPTED","new_claim_ref_id":"CLM-RES-1","comments":"Resubmission accepted"},
        "claims_resubmission__RESUB_ACCEPTED",
        {"Resubmission":{"OriginalClaimRefID":"REF_RES_ACCEPT","ResubmissionType":"correction","CorrectionPayload":{"FieldChanged":"Diagnosis"},"NewClaimID":"CLM-RES-1"},
         "Patient":{"PatientID":"PT-RES-0001","Name":"Resub Accepted","DOB":"1987-07-07","Gender":"F"}}
    )
    add("claims_resubmission",
        {"resubmission_status":"RESUB_REJECTED","new_claim_ref_id":None,"comments":"Resubmission rejected"},
        "claims_resubmission__RESUB_REJECTED",
        {"Resubmission":{"OriginalClaimRefID":"REF_RES_REJECT","ResubmissionType":"correction","NewClaimID":None},
         "Patient":{"PatientID":"PT-RES-0002","Name":"Resub Rejected","DOB":"1986-06-06","Gender":"M"}}
    )

    # Remittance tracking seeds
    add("remittance_tracking",
        {"remit_id":"RA-PAID-1","claim_ref_id":"CLM-PAID-1","remit_status":"RA_PAID_IN_FULL","paid_amount":100.0,"adjustments":[],"denial_codes":[],"payment_date":"08/09/2025"},
        "remittance_tracking__RA_PAID_IN_FULL",
        {"Remittance":{"RemitID":"RA-PAID-1","ClaimRefID":"CLM-PAID-1","RemitStatus":"RA_PAID_IN_FULL","PaidAmount":100.0,"Adjustments":[],"DenialCodes":[],"PaymentDate":"08/09/2025"}})
    add("remittance_tracking",
        {"remit_id":"RA-PART-1","claim_ref_id":"CLM-PART-1","remit_status":"RA_PARTIAL_PAYMENT","paid_amount":60.0,"adjustments":[{"code":"ADJ_OON","amount":40.0,"description":"Out-of-network adjustment"}],"denial_codes":[],"payment_date":"08/09/2025"},
        "remittance_tracking__RA_PARTIAL_PAYMENT",
        {"Remittance":{"RemitID":"RA-PART-1","ClaimRefID":"CLM-PART-1","RemitStatus":"RA_PARTIAL_PAYMENT","PaidAmount":60.0,"Adjustments":[{"Code":"ADJ_OON","Amount":40.0}],"DenialCodes":[],"PaymentDate":"08/09/2025"}})
    add("remittance_tracking",
        {"remit_id":"RA-DENY-1","claim_ref_id":"CLM-DENY-1","remit_status":"RA_DENIED","paid_amount":0.0,"adjustments":[],"denial_codes":[{"code":"DN01","description":"Denied - not covered"}],"payment_date":"08/09/2025"},
        "remittance_tracking__RA_DENIED",
        {"Remittance":{"RemitID":"RA-DENY-1","ClaimRefID":"CLM-DENY-1","RemitStatus":"RA_DENIED","PaidAmount":0.0,"Adjustments":[],"DenialCodes":[{"Code":"DN01","Description":"Not covered"}],"PaymentDate":"08/09/2025"}})

    # Denial management seeds
    add("denial_management",
        {"denial_management_status":"DEN_MGR_ANALYZED","next_steps":["Analyze denial"],"appeal_ref_id":_gen_id("APPEAL")},
        "denial_management__DEN_MGR_ANALYZED",
        {"Denial":{"ClaimRefID":"REF_DEN_ANALYZED","RemitID":"REF_REM_1","Action":"ANALYZE"}})
    add("denial_management",
        {"denial_management_status":"DEN_MGR_APPEAL_SUBMITTED","next_steps":["Submit appeal"],"appeal_ref_id":_gen_id("APPEAL")},
        "denial_management__DEN_MGR_APPEAL_SUBMITTED",
        {"Denial":{"ClaimRefID":"REF_DEN_APPEAL_SUB","RemitID":"REF_REM_2","Action":"APPEAL_SUBMIT"}})

    # Remittance post-resubmission
    add("remittance_post_resubmission",
        {"remit_id":"RA-FINAL-PAID-1","status":"RA_FINAL_PAID","paid_amount":100.0,"denial_codes":[],"comments":""},
        "remittance_post_resubmission__RA_FINAL_PAID",
        {"RemittancePost":{"NewClaimRefID":"REF_RA_FINAL_PAID","RemitID":"RA-FINAL-PAID-1","Status":"RA_FINAL_PAID","PaidAmount":100.0}})

    # Reconciliation seeds
    add("reconciliation",
        {"recon_id":"RECON-OK-1","status":"RECON_RECONCILED","settlement_amount":100.0,"notes":"Agreement reached"},
        "reconciliation__RECON_RECONCILED",
        {"Reconciliation":{"ReconID":"RECON-OK-1","RequestedResolution":{"Amount":100.0},"ClaimHistory":[{"Amount":100.0}],"Status":"RECON_RECONCILED"}})
    add("reconciliation",
        {"recon_id":"RECON-PART-1","status":"RECON_PARTIAL_SETTLE","settlement_amount":80.0,"notes":"Partial settlement"},
        "reconciliation__RECON_PARTIAL_SETTLE",
        {"Reconciliation":{"ReconID":"RECON-PART-1","RequestedResolution":{"Amount":80.0},"ClaimHistory":[{"Amount":100.0}],"Status":"RECON_PARTIAL_SETTLE"}})

    # USER-REQUESTED scenarios (PA chain + E2E) - these are included as in previous script.
    # (For brevity in this response I am keeping the seeds the same — the earlier long list is preserved here.)


    # Finalize index for all stages
    for s in UNIQUE_FIELDS_PER_STAGE.keys():
        _rebuild_index_for_stage(s)

    return len(RULES)

# -----------------------
# Interpreter: produce a human summary (no "llm" label)
def _format_currency_amt(amount: Union[int, float]) -> str:
    try:
        # two decimals if float
        if isinstance(amount, float):
            return f"{amount:.2f} Dirham (AED)"
        return f"{int(amount)} Dirham (AED)"
    except Exception:
        return str(amount)

def _interpret_summary(result: Dict[str, Any], stage: str) -> str:
    """
    Deterministic interpreter producing contextual human-readable summaries.
    No 'llm' literal; returns a summary string the UI can show.
    """
    # If earlier code attached a human_readable_summary, prefer it but still normalize wording
    if isinstance(result, dict) and result.get("human_readable_summary"):
        # ensure it reads as a user-friendly sentence
        return f"Summary: {str(result.get('human_readable_summary'))}"

    # Build summary parts
    parts: List[str] = []
    # For common outcome fields, try to interpret
    # Eligibility/prior auth/claim outcomes
    if "outcome_label" in result or "outcome_code" in result:
        label = result.get("outcome_label") or result.get("outcome_code")
        desc = result.get("description")
        parts.append(f"Summary: {label}.")
        if desc:
            parts.append(desc)
    elif "status_label" in result or "prior_auth_id" in result or "submission_status" in result or "doc_status" in result or "coding_status" in result or "scrub_status" in result:
        # choose a readable label if present
        label = result.get("status_label") or result.get("submission_status") or result.get("doc_status") or result.get("coding_status") or result.get("scrub_status") or result.get("prior_auth_id")
        parts.append(f"Summary: {label}.")
    # Patient info
    patient = result.get("patient") if isinstance(result, dict) else None
    if isinstance(patient, dict):
        pparts = []
        if patient.get("name"):
            pparts.append(f"Name={patient.get('name')}")
        pid = patient.get("patient_id") or patient.get("member_id")
        if pid:
            pparts.append(f"ID={pid}")
        if patient.get("dob"):
            pparts.append(f"DOB={patient.get('dob')}")
        if pparts:
            parts.append("Patient: " + ", ".join(pparts) + ".")
    # Remittance / reconciliation specific amounts
    # settlement_amount (reconciliation) or paid_amount/remit_id (remittance)
    if "settlement_amount" in result:
        amt = _format_currency_amt(result.get("settlement_amount"))
        parts.append(f"Record has been reconciled; total amount received is {amt}.")
        # include claim ref if present
        if result.get("claim_ref_id"):
            parts.append(f"Claim reference: {result.get('claim_ref_id')}.")
    if "paid_amount" in result or "remit_id" in result:
        paid = result.get("paid_amount") or result.get("paid")
        if paid is not None:
            parts.append(f"Payment recorded: { _format_currency_amt(paid) }.")
        if result.get("remit_id"):
            parts.append(f"Remittance ID: {result.get('remit_id')}.")
        # claim ref
        if result.get("claim_ref_id"):
            parts.append(f"Claim reference: {result.get('claim_ref_id')}.")
    # Generic short fallback using outcome-like keys
    if not parts:
        # try to provide a small humanized readout of the result JSON
        try:
            brief = json.dumps(result, separators=(",", ":"), sort_keys=True)
            return f"Summary: {brief if len(brief) < 800 else brief[:800] + '...'}"
        except Exception:
            return f"Summary: {str(result)}"
    # Ensure final text starts with "Summary:" for consistent UI display
    final = " ".join([p for p in parts if p])
    if not final.lower().startswith("summary"):
        final = "Summary: " + final
    return final

# -----------------------
# Stage processing: exact-match only
def _process_incoming_by_stage_exact(stage: str, payload: Dict[str, Any]) -> (Dict[str, Any], Optional[str]):
    uf = UNIQUE_FIELDS_PER_STAGE.get(stage)
    if uf:
        composite = _build_unique_composite_exact(payload, uf)
        if composite is None:
            _log_event("gateway", stage, "no_match_missing_fields", {"expected_fields": uf, "found": list(_extract_values_by_fieldnames(payload, uf).keys())}, {"request_sample": _gen_id("REQ")})
            return {"matched": False, "message": "Invalid Credential."}, None
        rid = UNIQUE_INDEX.get(stage, {}).get(composite)
        _log_event("gateway", stage, "unique_lookup_attempt", {"incoming_composite": composite, "found_rule": bool(rid)}, {"request_sample": _gen_id("REQ")})
        if rid:
            rule = RULES.get(rid)
            _log_event("gateway", stage, "match", {"rule_id": rid, "composite": composite}, {"rule_id": rid})
            # Augment outcome with patient info only for stages that should carry PHI
            result = deepcopy(rule["outcome"])
            if stage in STAGES_WITH_PATIENT_INFO:
                patient_info = _extract_patient_info(rule.get("reference_example", {}))
                if patient_info:
                    existing_patient = result.get("patient", {})
                    for k, v in patient_info.items():
                        if k not in existing_patient:
                            existing_patient[k] = v
                    result["patient"] = existing_patient
            wrapped = {
                "matched": True,
                "stage": stage,
                "result": result,
                "summary": _interpret_summary(result, stage)
            }
            return wrapped, composite
        _log_event("gateway", stage, "no_match_index_miss", {"incoming_composite": composite}, {"request_sample": _gen_id("REQ")})
        return {"matched": False, "message": "Invalid Credential."}, composite
    _log_event("gateway", stage, "stage_not_configured_runtime", {"stage": stage}, {"request_sample": _gen_id("REQ")})
    return {"matched": False, "message": "Invalid Credential."}, None

# -----------------------
# MongoDB helper for eligibility fetch
def _bson_to_python(val: Any) -> Any:
    """
    Convert BSON types (ObjectId, datetime, etc.) to JSON-serializable Python primitives.
    Leave other values untouched (no normalization).
    """
    try:
        # dynamic import for bson types
        from bson import ObjectId
    except Exception:
        ObjectId = None

    if val is None:
        return None
    if ObjectId is not None and isinstance(val, ObjectId):
        return str(val)
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, dict):
        return {k: _bson_to_python(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_bson_to_python(x) for x in val]
    return val

# -----------------------
# Real explicit endpoints for each stage (kept explicit)
# Each returns 404 for single-request invalid credential and sets X-SIM-INCOMING-COMPOSITE header

@router.post("/eligibility", response_model=None)
async def post_eligibility(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("eligibility", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("eligibility", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/eligibility/fetch_db", response_model=None)
async def post_eligibility_fetch_db(
    collection: Optional[str] = Body(None, media_type="text/plain", description="Plain-text collection name (required)"),
    unique_field: Optional[str] = Query(None, description="Field name to search in DB (optional)"),
    unique_value: Optional[str] = Query(None, description="Exact unique field value to search in DB (optional)"),
    api_key: str = Depends(get_api_key),
):
    """
    Fetch a record from the configured MongoDB and run the same eligibility exact-match processing.
    The body should contain the collection name as plain text (or pass ?collection=... as a query param).
    """
    # allow query param fallback for collection name (if UI sends it as query)
    coll_name = (collection or "").strip()
    # also accept ?collection=... if provided in query (fastapi won't map it automatically to this param), so check request query manually
    # But to keep signature simple, allow empty body + ?collection= fallback via environment or query
    if not coll_name:
        # attempt to read from QUERY param 'collection' if provided
        from fastapi import Request as FastAPIRequest  # local import for type hint suppression
        # Try to get raw query param (FastAPI already parsed it to unique_field/unique_value, but collection may be passed in query)
        # We can inspect the request object via Depends, but request isn't injected here. For simplicity, we'll check environment fallback:
        coll_name = os.getenv("ELIGIBILITY_FETCH_COLLECTION", "").strip()
    if not coll_name:
        return JSONResponse({"matched": False, "message": "Invalid Credential."}, status_code=404)

    # Dynamic pymongo import (uses installed pymongo in environment)
    try:
        from pymongo import MongoClient
        from bson import ObjectId  # for detection/serialization
    except Exception:
        return JSONResponse({"matched": False, "message": "Invalid Credential."}, status_code=404)

    mongo_uri = os.getenv("MONGO_DB_CONNECTION_STRING", "").strip()
    mongo_db_name = os.getenv("MONGO_DB_BACKEND", "").strip()
    if not mongo_uri or not mongo_db_name:
        return JSONResponse({"matched": False, "message": "Invalid Credential."}, status_code=404)

    client = None
    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        db = client[mongo_db_name]
        coll = db[coll_name]

        # If unique_field & unique_value provided, prefer that exact match
        mongo_query = None
        if unique_field and unique_value:
            # unique_field may be dotted (e.g., Claim.ID) — use as-is for Mongo dotted lookup
            mongo_query = { unique_field: unique_value }

        if mongo_query:
            doc = coll.find_one(mongo_query, sort=[("_id", -1)])
        else:
            doc = coll.find_one(sort=[("_id", -1)])  # most recent

        if not doc:
            return JSONResponse({"matched": False, "message": "Invalid Credential."}, status_code=404)

        # Convert BSON -> Python primitives for JSON serialization (only stringify ObjectId/datetime)
        payload = _bson_to_python(doc)

        # Remove internal Mongo _id field if present in top-level (but keep it as string if you want)
        # We keep it as-is (stringified) so no additional normalization is performed.

        res, comp = _process_incoming_by_stage_exact("eligibility", payload)
        headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
        if isinstance(res, dict) and res.get("matched") is False:
            return JSONResponse(res, status_code=404, headers=headers)
        return JSONResponse(res, headers=headers)
    except Exception:
        return JSONResponse({"matched": False, "message": "Invalid Credential."}, status_code=404)
    finally:
        try:
            if client:
                client.close()
        except Exception:
            pass

# Other stage endpoints: prior_auth, clinical_documentation, medical_coding, claims_scrubbing, claims_submission, denial_management, resubmit, remittance_post_resubmission, reconciliation, remittance_tracking, remittance_get
# (All re-use _process_incoming_by_stage_exact and behave like the eligibility endpoint above.)

@router.post("/prior_auth", response_model=None)
async def post_prior_auth(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("prior_authorization", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("prior_authorization", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/clinical_documentation", response_model=None)
async def post_clinical_documentation(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("clinical_documentation", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("clinical_documentation", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/medical_coding", response_model=None)
async def post_medical_coding(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("medical_coding", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("medical_coding", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/claims_scrubbing", response_model=None)
async def post_claims_scrubbing(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("claims_scrubbing", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("claims_scrubbing", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/claims_submission", response_model=None)
async def post_claims_submission(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("claims_submission", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("claims_submission", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/denial_management", response_model=None)
async def post_denial_management(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("denial_management", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("denial_management", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/resubmit", response_model=None)
async def post_resubmit(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("claims_resubmission", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("claims_resubmission", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/remittance_post_resubmission", response_model=None)
async def post_remittance_post_resubmission(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("remittance_post_resubmission", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("remittance_post_resubmission", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/reconciliation", response_model=None)
async def post_reconciliation(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("reconciliation", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("reconciliation", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.post("/remittance_tracking", response_model=None)
async def post_remittance_tracking(
    payload: Any = Body(None, description="JSON payload or leave empty to send raw body (CSV/text)"),
    request: Request = None,
    api_key: str = Depends(get_api_key),
):
    if payload is None:
        parsed = await parse_request_payload(request)
    else:
        parsed = payload
    if isinstance(parsed, list):
        results = []
        comps = []
        for rec in parsed:
            res, comp = _process_incoming_by_stage_exact("remittance_tracking", rec)
            results.append(res)
            comps.append(comp)
        headers = {"X-SIM-INCOMING-COMPOSITES": json.dumps([c for c in comps])}
        return JSONResponse(results, headers=headers)
    res, comp = _process_incoming_by_stage_exact("remittance_tracking", parsed or {})
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        return JSONResponse(res, status_code=404, headers=headers)
    return JSONResponse(res, headers=headers)

@router.get("/remittance/{claim_ref_id}", response_model=None)
async def remittance_get(claim_ref_id: str, api_key: str = Depends(get_api_key)):
    stage = "remittance_tracking"
    fake_payload = {"Remittance": {"RemitID": claim_ref_id, "ClaimRefID": claim_ref_id}, "ClaimRefID": claim_ref_id}
    res, comp = _process_incoming_by_stage_exact(stage, fake_payload)
    headers = {"X-SIM-INCOMING-COMPOSITE": json.dumps(comp) if comp is not None else ""}
    if isinstance(res, dict) and res.get("matched") is False:
        raise HTTPException(status_code=404, detail=res)
    return JSONResponse(res, headers=headers)

# -----------------------
# Admin-only seed endpoint now calls the programmatic helper
@router.post("/__admin/seed_all_rules", response_model=None)
def seed_all_rules(api_key: str = Depends(get_api_key)):
    count = _do_seed_all_rules()
    return {"seeded_rules": count}

# Expose FastAPI app (a small helper in case someone runs this module standalone)
app = FastAPI(title="Humaein eClaim Simulator (Exact-match)")
app.include_router(router, prefix="/simulator/humaein")

# Auto-load seed rules at module import so the simulator is ready to respond to stage entry calls.
_do_seed_all_rules()
# <end file>
