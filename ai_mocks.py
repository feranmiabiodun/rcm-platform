# ai_mocks.py
from fastapi import APIRouter, Body
from typing import Any, Dict
import re

router = APIRouter()

# simple regex helpers
_RE_CLAIM = re.compile(r"\bCLM[-_]?[A-Z0-9]+\b", flags=re.I)
_RE_MEMBER = re.compile(r"\b784[-\d]{5,}\b")  # GCC-style member prefix used in seeded data
_RE_PRIORAUTH = re.compile(r"\bPAR[-_]?[A-Z0-9]+\b", flags=re.I)
_RE_REMIT = re.compile(r"\bRA[-_]?[A-Z0-9]+\b", flags=re.I)

@router.post("/mock_ocr")
async def mock_ocr(payload: Dict[str, Any] = Body(...)):
    """
    Lightweight mock OCR: extracts obvious IDs from text fields and returns them
    in a consistent structure the orchestrator expects:
      { member_id, patient: {patient_id}, claim_id_candidates, remit_id_candidates, raw_text }
    """
    # extract text candidate sources
    text = ""
    if isinstance(payload, dict):
        # look for a ClinicalDocument.text or text top-level
        cd = payload.get("ClinicalDocument")
        if isinstance(cd, dict):
            text = cd.get("text", "") or ""
        if not text:
            text = payload.get("text", "") or ""
        # fallback: stringify the whole payload (safe for demo)
        if not text:
            text = " ".join([str(v) for v in payload.values() if isinstance(v, (str, int))])
    else:
        text = str(payload)

    text = text or ""

    claim_ids = _RE_CLAIM.findall(text)
    member_ids = _RE_MEMBER.findall(text)
    prior_ids = _RE_PRIORAUTH.findall(text)
    remit_ids = _RE_REMIT.findall(text)

    # normalize values (strip, keep case)
    claim_ids = [c.strip() for c in claim_ids]
    member_ids = [m.strip() for m in member_ids]
    prior_ids = [p.strip() for p in prior_ids]
    remit_ids = [r.strip() for r in remit_ids]

    # simple patient id heuristics: if member present, produce a patient id variant
    patient_id = None
    if member_ids:
        patient_id = "PT-" + member_ids[0].replace("784-", "").replace("-", "")[:8]

    out = {
        "raw_text": text,
        "member_id": member_ids[0] if member_ids else None,
        "patient": {"patient_id": patient_id} if patient_id else {},
        "claim_id_candidates": claim_ids or [],
        "prior_auth_candidates": prior_ids or [],
        "remit_id_candidates": remit_ids or [],
        "notes": "This is a deterministic OCR mock for demo. It looks for CLM*, PAR*, RA* and GCC member patterns.",
    }
    return out

@router.post("/mock_llm")
async def mock_llm(body: Dict[str, Any] = Body(...)):
    """
    Lightweight LLM mock:
    - Accepts {"extracted": <ocr-result>, "stage": "<stage>"}
    - Returns an LLM-style summary, confidence, and suggested structured fields.
    """
    extracted = body.get("extracted") or {}
    stage = (body.get("stage") or "unknown").lower()

    # build a simple summary
    raw_text = extracted.get("raw_text") or ""
    member = extracted.get("member_id")
    claim_candidates = extracted.get("claim_id_candidates") or []
    remit_candidates = extracted.get("remit_id_candidates") or []

    summary_parts = []
    if member:
        summary_parts.append(f"Member detected: {member}")
    if claim_candidates:
        summary_parts.append(f"Claim(s) found: {', '.join(claim_candidates)}")
    if remit_candidates:
        summary_parts.append(f"Remit(s) found: {', '.join(remit_candidates)}")
    if not summary_parts:
        summary_parts.append("No clear IDs detected in document.")

    confidence = 0.92 if member or claim_candidates or remit_candidates else 0.55

    # Suggest a structured payload to attach / submit
    suggestion = {}
    if stage in ("eligibility", "claims_scrubbing", "claims_submission", "medical_coding"):
        # prefer claim+member pair
        if claim_candidates:
            suggestion = {"Claim": {"ID": claim_candidates[0], "MemberID": member or None}}
        elif member:
            suggestion = {"Claim": {"MemberID": member}}
    elif stage == "prior_authorization":
        if extracted.get("prior_auth_candidates"):
            suggestion = {"PriorAuthorizationRequest": {"RequestID": extracted.get("prior_auth_candidates")[0], "MemberID": member or None}}
    elif stage in ("remittance_tracking", "remittance_post_resubmission"):
        if remit_candidates:
            suggestion = {"Remittance": {"RemitID": remit_candidates[0], "ClaimRefID": remit_candidates[0]}}

    return {
        "stage": stage,
        "summary": " | ".join(summary_parts),
        "confidence": confidence,
        "suggested_payload": suggestion,
        "extracted": extracted
    }
