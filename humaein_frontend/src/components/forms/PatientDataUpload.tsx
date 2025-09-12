import React, { useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileUploader } from '../FileUploader';
import {
  checkEligibility,
  priorAuth,
  uploadClinicalDocument,
  medicalCoding,
  claimsScrub,
  claimsSubmit,
  remittance,
  denialManagement,
  resubmit,
  reconciliation,
} from '@/services/api';
import { API_BASE } from '@/config/api';

// --------------------------- types ---------------------------
interface PatientDataUploadProps {
  categoryId: string;
  optionId: string;
}

interface ColumnMapping {
  fileColumn: string;
  mappedTo: string;
}

// --------------------------- defaults & helpers ---------------------------

// Default column mappings per stage
const getDefaultMappings = (categoryId: string): Record<string, string> => {
  const mappings: Record<string, Record<string, string>> = {
    'check-eligibility': {
      'member_id': 'memberId',
      'national_id': 'nationalId',
      'payer': 'payer',
      'date_of_service': 'dateOfService'
    },
    'prior-authorization': {
      'member_id': 'memberId',
      'national_id': 'nationalId',
      'payer': 'payer',
      'procedure_code': 'procedureCode',
      'requesting_provider': 'requestingProvider'
    },
    'clinical-documentation': {
      'claim_id': 'claimId',
      'patient_id': 'patientId'
    },
    'medical-coding': {
      'claim_id': 'claimId',
      'patient_id': 'patientId',
      'date_of_service': 'dateOfService'
    }
  };

  return mappings[categoryId] || {};
};

// Expected fields (canonical) per stage
const getExpectedFields = (categoryId: string): string[] => {
  const fields: Record<string, string[]> = {
    'check-eligibility': ['memberId', 'nationalId', 'payer', 'dateOfService'],
    'prior-authorization': ['memberId', 'nationalId', 'payer', 'procedureCode', 'requestingProvider'],
    'clinical-documentation': ['claimId', 'patientId'],
    'medical-coding': ['claimId', 'patientId', 'dateOfService'],
    'claims-scrubbing': ['claimId', 'patientId', 'providerNPI', 'payer'],
    'claims-submission': ['claimId', 'providerNPI', 'payer'],
    'remittance': ['claimId', 'paymentReference', 'payer'],
    'denial-management': ['claimId', 'payer'],
    'resubmit': ['originalSubmissionId', 'claimId', 'payer'],
    'reconciliation': ['claimId', 'paymentReference']
  };

  return fields[categoryId] || [];
};

// flatten nested objects to dot keys, e.g. { Claim: { ID: 'x' } } -> { 'Claim.ID': 'x' }
function flattenObject(obj: any, prefix = '', out: Record<string, unknown> = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        flattenObject(v, key, out);
      } else {
        out[key] = v;
      }
    }
  } else {
    out[prefix] = obj;
  }
  return out;
}

// convert strings like "MemberID" or "memberId" or "member-id" to snake case "member_id"
function toSnakeCase(s: string) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s\-\.]+/g, '_')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

// pretty label for UI
function prettyLabel(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_\.]+/g, ' ')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// normalize a header/key for tolerant matching
function normalizeKeyName(k: string) {
  return String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// --------------------------- endpoint-ready detector ---------------------------

function isEndpointReadyPayload(categoryId: string, arr: any[]): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;

  const expectedInputShapes: Record<string, Array<{ wrapper?: string; keys: string[] }>> = {
    "check-eligibility": [{ wrapper: "Claim", keys: ["ID", "MemberID"] }],
    "prior-authorization": [{ wrapper: "PriorAuthorizationRequest", keys: ["RequestID", "MemberID"] }, { wrapper: "PriorAuthorizationRequest", keys: ["RequestID"] }],
    "clinical-documentation": [{ wrapper: "ClinicalDocument", keys: ["ProcedureCode"] }, { wrapper: "ClinicalDocument", keys: ["ClinicianID"] }],
    "medical-coding": [{ wrapper: "Claim", keys: ["ID"] }],
    "claims-scrubbing": [{ wrapper: "Claim", keys: ["ExternalID"] }, { wrapper: "Claim", keys: ["ServiceLines"] }],
    "claims-submission": [{ wrapper: "ClaimSubmission", keys: ["ExternalID"] }, { wrapper: "ClaimSubmission", keys: ["ClaimID"] }],
    "remittance": [{ wrapper: "Remittance", keys: ["RemitID", "ClaimRefID"] }],
    "denial-management": [{ wrapper: "Denial", keys: ["ClaimRefID"] }],
    "resubmit": [{ wrapper: "Resubmission", keys: ["OriginalClaimRefID"] }, { wrapper: "Resubmission", keys: ["OriginalClaimID"] }],
    "reconciliation": [{ wrapper: "Reconciliation", keys: ["ReconID"] }]
  };

  const candidates = expectedInputShapes[categoryId] ?? [];

  const matchesCandidate = (item: any, cand: { wrapper?: string; keys: string[] }) => {
    if (!item || typeof item !== "object") return false;
    if (cand.wrapper) {
      const wrapped = item[cand.wrapper];
      if (!wrapped || typeof wrapped !== "object") return false;
      return cand.keys.every(k => Object.prototype.hasOwnProperty.call(wrapped, k));
    } else {
      return cand.keys.every(k => Object.prototype.hasOwnProperty.call(item, k));
    }
  };

  return arr.every(item => candidates.some(c => matchesCandidate(item, c)));
}

// --------------------------- CSV -> endpoint transformer ---------------------------

function transformCsvRowToEndpoint(row: Record<string, string>, categoryId: string): any | null {
  function getVal(...candidates: string[]) {
    const normalizedCandidates = candidates.map(c => normalizeKeyName(c));
    for (const key of Object.keys(row)) {
      const n = normalizeKeyName(key);
      if (normalizedCandidates.includes(n)) return row[key];
    }
    return undefined;
  }

  function parseArrayLike(v: any) {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v;
    const s = String(v).trim();
    if (s === '') return [];
    if (s.includes(';')) return s.split(';').map(x => x.trim()).filter(Boolean);
    if (s.includes(',')) return s.split(',').map(x => x.trim()).filter(Boolean);
    return [s];
  }

  switch (categoryId) {
    case "check-eligibility": {
      const claimId = getVal('claim.id', 'claimid', 'id', 'claim_id');
      const memberId = getVal('claim.memberid', 'memberid', 'member_id', 'memberid');
      if (claimId !== undefined && memberId !== undefined) {
        return { Claim: { ID: String(claimId), MemberID: String(memberId) } };
      }
      return null;
    }
    case "prior-authorization": {
      const reqId = getVal('priorauthorizationrequest.requestid', 'requestid', 'request_id', 'request id', 'request');
      const memberId = getVal('priorauthorizationrequest.memberid', 'memberid', 'member_id');
      const proc = parseArrayLike(getVal('procedurecodes', 'procedure_codes', 'procedure_code', 'procedures', 'procedurecode'));
      const requestedUnits = getVal('requestedunits', 'requested_units', 'requested_units');
      const out: any = {};
      if (reqId !== undefined) out.RequestID = String(reqId);
      if (memberId !== undefined) out.MemberID = String(memberId);
      if (proc !== undefined) out.ProcedureCodes = proc;
      if (requestedUnits !== undefined) out.RequestedUnits = Number(requestedUnits) || requestedUnits;
      return Object.keys(out).length ? { PriorAuthorizationRequest: out } : null;
    }
    case "clinical-documentation": {
      const procCode = getVal('clinicaldocument.procedurecode', 'procedurecode', 'procedure_code', 'procedure');
      if (procCode !== undefined) {
        const clinician = getVal('clinicaldocument.clinicianid', 'clinicianid', 'clinician_id', 'clinician');
        const attachments = parseArrayLike(getVal('attachments', 'attachment'));
        const out: any = { ProcedureCode: String(procCode) };
        if (clinician !== undefined) out.ClinicianID = String(clinician);
        if (attachments !== undefined) out.Attachments = attachments;
        return { ClinicalDocument: out };
      }
      return null;
    }
    case "medical-coding": {
      const claimId = getVal('claim.id', 'claimid', 'id', 'claim_id');
      if (claimId !== undefined) {
        const svc = parseArrayLike(getVal('servicelineitems', 'service_line_items', 'servicelines', 'serviceline'));
        const out: any = { ID: String(claimId) };
        if (svc !== undefined) out.ServiceLineItems = svc;
        return { Claim: out };
      }
      return null;
    }
    case "claims-scrubbing": {
      const externalId = getVal('claim.externalid', 'externalid', 'external_id', 'externalid');
      if (externalId !== undefined) return { Claim: { ExternalID: String(externalId) } };
      const serviceLines = getVal('claim.servicelines', 'servicelines', 'service_lines', 'service_line');
      if (serviceLines !== undefined) return { Claim: { ServiceLines: parseArrayLike(serviceLines) } };
      return null;
    }
    case "claims-submission": {
      const external = getVal('claimsubmission.externalid', 'externalid', 'external_id', 'externalid');
      const claimid = getVal('claimsubmission.claimid', 'claimid', 'claim_id', 'claimid');
      if (external !== undefined) return { ClaimSubmission: { ExternalID: String(external) } };
      if (claimid !== undefined) return { ClaimSubmission: { ClaimID: String(claimid) } };
      return null;
    }
    case "remittance": {
      const remit = getVal('remittance.remitid', 'remitid', 'remit_id', 'remit');
      const claimRef = getVal('remittance.claimrefid', 'claimrefid', 'claim_ref_id', 'claimref', 'claimrefid');
      if (remit !== undefined && claimRef !== undefined) {
        const paid = getVal('remittance.paidamount', 'paidamount', 'paid_amount');
        const out: any = { RemitID: String(remit), ClaimRefID: String(claimRef) };
        if (paid !== undefined) out.PaidAmount = Number(paid) || paid;
        return { Remittance: out };
      }
      return null;
    }
    case "denial-management": {
      const claimRef = getVal('denial.claimrefid', 'claimrefid', 'claim_ref_id', 'claimrefid');
      const action = getVal('denial.action', 'action');
      if (claimRef !== undefined) {
        const out: any = { ClaimRefID: String(claimRef) };
        if (action !== undefined) out.Action = String(action);
        return { Denial: out };
      }
      return null;
    }
    case "resubmit": {
      const orig = getVal('resubmission.originalclaimrefid', 'originalclaimrefid', 'original_claim_ref_id', 'original_claim_ref');
      const originalClaimId = getVal('resubmission.originalclaimid', 'originalclaimid', 'original_claim_id');
      if (orig !== undefined || originalClaimId !== undefined) {
        const out: any = {};
        if (orig !== undefined) out.OriginalClaimRefID = String(orig);
        if (originalClaimId !== undefined) out.OriginalClaimID = String(originalClaimId);
        return { Resubmission: out };
      }
      return null;
    }
    case "reconciliation": {
      const reconId = getVal('reconciliation.reconid', 'reconid', 'recon_id', 'reconid');
      if (reconId !== undefined) return { Reconciliation: { ReconID: String(reconId) } };
      return null;
    }
    default:
      return null;
  }
}

/**
 * Parse CSV text into headers + rows (rows are objects keyed by header names)
 */
function parseCsvTextToRows(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
  return { headers, rows };
}

// --------------------------- component ---------------------------

export const PatientDataUpload: React.FC<PatientDataUploadProps> = ({ categoryId, optionId }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [parsedData, setParsedData] = useState<Array<Record<string, unknown>>>([]);
  const [fileColumns, setFileColumns] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [validationMessage, setValidationMessage] = useState<string>('');

  // raw parsed JSON array exactly as read from uploaded file or transformed from CSV
  const [rawParsedArray, setRawParsedArray] = useState<Array<any>>([]);
  // indicates whether upload has been accepted (strict match to ingestion shape)
  const [uploadAccepted, setUploadAccepted] = useState<boolean>(false);

  // preview of server results
  const [resultsPreview, setResultsPreview] = useState<Array<Record<string, unknown>> | null>(null);

  const defaultMappings = getDefaultMappings(categoryId);
  const expectedFields = getExpectedFields(categoryId);

  // Keep mapping hidden by default (upload-only mode). You can set to true to show mapping UI.
  const showMapping = false;

  // Debug: print environment & API_BASE on mount to help diagnose invalid URL issues
  useEffect(() => {
    try {
      console.debug('VITE env (import.meta.env.VITE_API_BASE) =', import.meta.env?.VITE_API_BASE);
    } catch (_) {
      // environment not accessible
    }
    console.debug('API_BASE from config:', API_BASE);
    try {
      // attempt to construct to surface invalid format in console
      // this won't break the app (we catch)
      // eslint-disable-next-line no-new
      new URL(String(API_BASE));
    } catch (e) {
      console.warn('API_BASE appears invalid for URL construction:', API_BASE, e);
    }
  }, []);

  const handleFilesChange = async (newFiles: File[]) => {
    setFiles(newFiles);
    setRawParsedArray([]);
    setUploadAccepted(false);
    setValidationStatus('idle');
    setValidationMessage('');

    if (newFiles.length > 0) {
      const file = newFiles[0];
      setIsProcessing(true);
      try {
        if (file.name.toLowerCase().endsWith('.json')) {
          await parseJSON(file);
        } else {
          // attempt CSV parsing -> transform to endpoint shape
          await parseCSVFile(file);
        }
      } finally {
        setIsProcessing(false);
      }
    } else {
      setParsedData([]);
      setFileColumns([]);
      setColumnMappings([]);
    }
  };

  const parseCSVFile = async (file: File) => {
    try {
      const text = await file.text();
      const { headers, rows } = parseCsvTextToRows(text);
      const transformed: any[] = [];
      for (const r of rows) {
        const t = transformCsvRowToEndpoint(r, categoryId);
        if (t === null) {
          setUploadAccepted(false);
          setValidationStatus('error');
          setValidationMessage('CSV does not contain required columns for this stage. Ensure headers contain the required fields (e.g. Claim.ID, Claim.MemberID for eligibility).');
          setParsedData([]);
          setFileColumns([]);
          setColumnMappings([]);
          setRawParsedArray([]);
          return;
        }
        transformed.push(t);
      }

      if (isEndpointReadyPayload(categoryId, transformed)) {
        setRawParsedArray(transformed);
        setUploadAccepted(true);
        setValidationStatus('success');
        setValidationMessage('CSV successfully parsed and matches ingestion shape. Click Submit to send.');
        setParsedData([]);
        setFileColumns([]);
        setColumnMappings([]);
      } else {
        setUploadAccepted(false);
        setValidationStatus('error');
        setValidationMessage('Transformed CSV does not match required ingestion shape for this stage.');
        setRawParsedArray([]);
      }
    } catch (error) {
      console.error('Error parsing CSV:', error);
      setUploadAccepted(false);
      setValidationStatus('error');
      setValidationMessage('Failed to parse CSV. Ensure it is well-formed.');
    }
  };

  const parseJSON = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      if (isEndpointReadyPayload(categoryId, arr)) {
        setRawParsedArray(arr);
        setUploadAccepted(true);
        setParsedData([]);
        setFileColumns([]);
        setColumnMappings([]);
        setValidationStatus('success');
        setValidationMessage('Uploaded JSON is in the required ingestion shape. Click Submit to send.');
      } else {
        setRawParsedArray([]);
        setUploadAccepted(false);
        setParsedData([]);
        setFileColumns([]);
        setColumnMappings([]);
        setValidationStatus('error');
        setValidationMessage('Uploaded JSON is NOT in the required ingestion shape for the selected stage. Use Enter Patients Data for manual entry or fix the file.');
      }
    } catch (error) {
      console.error('Error parsing JSON upload:', error);
      setRawParsedArray([]);
      setUploadAccepted(false);
      setParsedData([]);
      setFileColumns([]);
      setColumnMappings([]);
      setValidationStatus('error');
      setValidationMessage('Failed to parse JSON file. Ensure it is valid JSON and matches the ingestion shape for the selected stage.');
    }
  };

  const parseCSV = (csvText: string) => {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return;

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = lines.slice(1, 6).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row as Record<string, unknown>;
    });

    setFileColumns(headers);
    setParsedData(data);
    initializeColumnMappings(headers);
  };

  const initializeColumnMappings = (headers: string[]) => {
    const mappings: ColumnMapping[] = headers.map(header => {
      const fullNorm = header.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const parts = header.split(/[.\s_:-]+/).filter(Boolean);
      const last = parts.length > 0 ? parts[parts.length - 1] : header;
      const lastSnake = toSnakeCase(last);

      let mappedField = '';
      if (defaultMappings[fullNorm]) mappedField = defaultMappings[fullNorm];
      else if (defaultMappings[lastSnake]) mappedField = defaultMappings[lastSnake];
      else mappedField = '';

      return {
        fileColumn: header,
        mappedTo: mappedField
      };
    });

    setColumnMappings(mappings);
    validateMappings(mappings);
  };

  const validateMappings = (mappings: ColumnMapping[]) => {
    const mappedFields = mappings.map(m => m.mappedTo).filter(Boolean);
    const requiredFields = expectedFields;
    const missingFields = requiredFields.filter(field => !mappedFields.includes(field));

    if (missingFields.length === 0) {
      setValidationStatus('success');
      setValidationMessage('All required fields are mapped correctly.');
    } else {
      setValidationStatus('error');
      setValidationMessage(`Missing required field mappings: ${missingFields.join(', ')}`);
    }
  };

  const updateMapping = (fileColumn: string, mappedTo: string) => {
    const normalizedMappedTo = mappedTo === '__none' ? '' : mappedTo;
    const updatedMappings = columnMappings.map(mapping =>
      mapping.fileColumn === fileColumn
        ? { ...mapping, mappedTo: normalizedMappedTo }
        : mapping
    );
    setColumnMappings(updatedMappings);
    validateMappings(updatedMappings);
  };

  const buildPayloadFromParsedData = (categoryIdLocal: string, parsedRows: Array<Record<string, unknown>>, mappings: ColumnMapping[]) => {
    const normalized = parsedRows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const m of mappings) {
        if (!m.mappedTo) continue;
        const value = row[m.fileColumn];
        if (value !== undefined) {
          obj[m.mappedTo] = value;
        } else {
          const alt = row[m.fileColumn.toLowerCase()];
          if (alt !== undefined) obj[m.mappedTo] = alt;
        }
      }
      return obj;
    });

    switch (categoryIdLocal) {
      case "check-eligibility":
        return normalized.map((r) => ({
          Claim: {
            ID: (r.claimId ?? r.claim_id ?? r.ID ?? '').toString(),
            MemberID: (r.memberId ?? r.member_id ?? r.MemberID ?? '').toString(),
          }
        }));
      case "prior-authorization":
        return normalized.map((r) => ({ PriorAuthorizationRequest: r }));
      case "clinical-documentation":
        return normalized.map((r) => ({ ClinicalDocument: r }));
      case "medical-coding":
        return normalized;
      case "claims-scrubbing":
        return normalized;
      case "claims-submission":
        return normalized;
      case "remittance":
        return normalized.map((r) => ({ Remittance: r }));
      case "denial-management":
        return normalized;
      case "resubmit":
        return normalized;
      case "reconciliation":
        return normalized;
      default:
        return normalized;
    }
  };

  const handleSubmit = async () => {
    // Validate API_BASE before attempting network call to avoid "Failed to construct 'URL'"
    try {
      // ensure API_BASE is a valid absolute URL
      // eslint-disable-next-line no-new
      new URL(String(API_BASE));
    } catch (e) {
      setValidationStatus('error');
      setValidationMessage(`Configured API base is invalid: ${String(API_BASE)}. Fix VITE_API_BASE or config and restart the frontend.`);
      return;
    }

    if (!uploadAccepted) {
      setValidationMessage('No valid uploaded payload to submit. Upload a JSON/CSV file in the endpoint-ready format for this stage.');
      setValidationStatus('error');
      return;
    }

    setIsProcessing(true);
    setValidationMessage('');
    setResultsPreview(null);

    try {
      const payload = rawParsedArray;

      let response;
      switch (categoryId) {
        case "check-eligibility":
          response = await checkEligibility(payload as unknown as Record<string, unknown>);
          break;
        case "prior-authorization":
          response = await priorAuth(payload as unknown as Record<string, unknown>);
          break;
        case "clinical-documentation":
          response = await uploadClinicalDocument(payload as unknown as FormData | unknown);
          break;
        case "medical-coding":
          response = await medicalCoding(payload as unknown as Record<string, unknown>);
          break;
        case "claims-scrubbing":
          response = await claimsScrub(payload as unknown as Record<string, unknown>);
          break;
        case "claims-submission":
          response = await claimsSubmit(payload as unknown as Record<string, unknown>);
          break;
        case "remittance":
          response = await remittance(payload as unknown as Record<string, unknown>);
          break;
        case "denial-management":
          response = await denialManagement(payload as unknown as Record<string, unknown>);
          break;
        case "resubmit":
          response = await resubmit(payload as unknown as Record<string, unknown>);
          break;
        case "reconciliation":
          response = await reconciliation(payload as unknown as Record<string, unknown>);
          break;
        default:
          response = await checkEligibility(payload as unknown as Record<string, unknown>);
      }

      // <-- FIXED LINE: use && not 'and' -->
      const data = (response && (response as any).data) ?? (response as any);
      if (Array.isArray(data)) {
        setResultsPreview(data as Array<Record<string, unknown>>);
      } else {
        setResultsPreview([data] as Array<Record<string, unknown>>);
      }

      setValidationStatus('success');
      setValidationMessage('Upload processed; see results below.');
    } catch (err: any) {
      console.error('submit error', err);
      setValidationStatus('error');
      setValidationMessage(err?.message ?? 'Failed to submit upload. See console.');
      if (err?.data) setResultsPreview(Array.isArray(err.data) ? err.data : [err.data]);
    } finally {
      setIsProcessing(false);
    }
  };

  // ===== New: preview limit and download function (minimal additions) =====
  const MAX_PREVIEW = 15;
  const displayPreview = resultsPreview ? resultsPreview.slice(0, MAX_PREVIEW) : [];

  const downloadResults = () => {
    if (!resultsPreview) return;
    const filename = `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(resultsPreview, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  // =======================================================================

  return (
    <div className="space-y-4">
      {/* File Upload */}
      <Card className="bg-brand-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-brand-charcoal flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload Patient Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FileUploader
            accept=".csv,.json"
            maxSize={50}
            multiple={false}
            onFilesChange={handleFilesChange}
            disabled={isProcessing}
          />
        </CardContent>
      </Card>

      {/* Mapping / Preview UI remains but hidden by default */}
      {showMapping && parsedData.length > 0 && (
        <Card className="bg-brand-panel border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-brand-charcoal flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Data Preview & Column Mapping
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <h5 className="text-sm font-medium text-brand-charcoal">Map Columns to Fields</h5>
              <div className="grid gap-3">
                {columnMappings.map((mapping) => (
                  <div key={mapping.fileColumn} className="flex items-center gap-3">
                    <div className="w-1/3">
                      <div className="text-sm font-medium text-brand-charcoal">
                        {mapping.fileColumn}
                      </div>
                      <div className="text-xs text-brand-muted-text">
                        File Column
                      </div>
                    </div>
                    <div className="text-brand-muted-text">→</div>
                    <div className="w-1/3">
                      <Select
                        value={mapping.mappedTo || '__none'}
                        onValueChange={(value) => updateMapping(mapping.fileColumn, value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select field..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">-- No mapping --</SelectItem>
                          {expectedFields.map(field => (
                            <SelectItem key={field} value={field}>
                              {prettyLabel(field)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {validationStatus !== 'idle' && (
              <Alert className={validationStatus === 'success' ? 'border-green-200 bg-green-50' : 'border-destructive bg-destructive/10'}>
                <div className="flex items-center gap-2">
                  {validationStatus === 'success' ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  <AlertDescription className={validationStatus === 'success' ? 'text-green-800' : 'text-destructive'}>
                    {validationMessage}
                  </AlertDescription>
                </div>
              </Alert>
            )}

            <div className="space-y-2">
              <h5 className="text-sm font-medium text-brand-charcoal">Data Preview (First 5 rows)</h5>
              <div className="border border-border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-brand-left-column">
                      {fileColumns.map(column => (
                        <TableHead key={column} className="text-xs font-medium text-brand-charcoal">
                          {column}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index}>
                        {fileColumns.map(column => {
                          const cell = row[column];
                          const display = cell !== undefined && cell !== null ? String(cell) : '-';
                          return (
                            <TableCell key={column} className="text-xs text-brand-charcoal">
                              {display}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit Button - only for uploadAccepted */}
      {uploadAccepted && (
        <Button
          onClick={handleSubmit}
          disabled={isProcessing}
          className="w-full bg-gradient-primary hover:bg-brand-accent-2 text-white"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Processing...
            </>
          ) : (
            'Submit Upload'
          )}
        </Button>
      )}

      {/* Show validation status when no mapping/preview */}
      {!showMapping && validationStatus !== 'idle' && (
        <Alert className={validationStatus === 'success' ? 'border-green-200 bg-green-50' : 'border-destructive bg-destructive/10'}>
          <div className="flex items-center gap-2">
            {validationStatus === 'success' ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
            <AlertDescription className={validationStatus === 'success' ? 'text-green-800' : 'text-destructive'}>
              {validationMessage}
            </AlertDescription>
          </div>
        </Alert>
      )}

      {/* Results Preview (readable) */}
      {resultsPreview && resultsPreview.length > 0 && (
        <Card className="bg-brand-panel border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-brand-charcoal flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Result Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {displayPreview.map((item, idx) => {
              const matched = item.matched ?? item['matched'];
              const stage = item.stage ?? item['stage'];
              const result = (item as any).result ?? (item as any);

              const patient = result?.patient;
              const claimRef = result?.claim_ref_id ?? result?.ClaimRefID ?? result?.claimId ?? result?.claim_id;
              const priorAuthId = result?.prior_auth_id ?? result?.PriorAuthID ?? result?.priorAuthId;

              // normalize stage for branch checks
              const normStage = String(stage ?? '').toLowerCase().replace(/[\s-]+/g, '_');

              return (
                <div key={idx} className="border p-2 rounded">
                  <div className="flex justify-between items-center">
                    <div className="text-sm font-medium">{stage ? prettyLabel(String(stage)) : `Result ${idx + 1}`}</div>
                    <div className={`text-xs ${matched ? 'text-green-700' : 'text-destructive'}`}>
                      {matched ? 'Matched' : 'Not matched'}
                    </div>
                  </div>

                  <div className="mt-2 text-sm">
                    {/* Patient block (unchanged from original) */}
                    {patient && (
                      <div className="mb-1">
                        <div className="text-xs font-medium">Patient</div>
                        <div className="text-xs">{`ID: ${patient.patient_id ?? patient.patientId ?? patient.id ?? '-'}`}</div>
                        <div className="text-xs">{`Name: ${patient.name ?? '-'}`}</div>
                        <div className="text-xs">{`DOB: ${patient.dob ?? '-'}`}</div>
                      </div>
                    )}

                    {/* Claim Ref (unchanged) */}
                    {claimRef && (
                      <div className="text-xs mb-1">
                        <div className="text-xs font-medium">Claim Ref</div>
                        <div className="text-xs">{String(claimRef)}</div>
                      </div>
                    )}

                    {/* Prior Auth (unchanged) */}
                    {priorAuthId && (
                      <div className="text-xs mb-1">
                        <div className="text-xs font-medium">Prior Auth</div>
                        <div className="text-xs">{String(priorAuthId)}</div>
                      </div>
                    )}

                    {/* Stage-specific additional fields (added, formatted like existing fields) */}
                    {/* Eligibility */}
                    {(normStage === 'eligibility' || normStage === 'check_eligibility') && result && (
                      <>
                        {result.outcome_code && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Outcome Code</div>
                            <div className="text-xs">{String(result.outcome_code)}</div>
                          </div>
                        )}
                        {result.outcome_label && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Outcome Label</div>
                            <div className="text-xs">{String(result.outcome_label)}</div>
                          </div>
                        )}
                        {result.description && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Description</div>
                            <div className="text-xs">{String(result.description)}</div>
                          </div>
                        )}
                        {result.required_actions && Array.isArray(result.required_actions) && result.required_actions.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Required Actions</div>
                            <div className="text-xs">
                              {result.required_actions.join(', ')}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Prior authorization */}
                    {(normStage === 'prior_authorization' || normStage === 'prior_authorisation' || normStage === 'prior-authorization') && result && (
                      <>
                        {result.prior_auth_id && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Prior Auth ID</div>
                            <div className="text-xs">{String(result.prior_auth_id)}</div>
                          </div>
                        )}
                        {result.status_code && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Status Code</div>
                            <div className="text-xs">{String(result.status_code)}</div>
                          </div>
                        )}
                        {result.status_label && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Status Label</div>
                            <div className="text-xs">{String(result.status_label)}</div>
                          </div>
                        )}
                        {result.approved_items && Array.isArray(result.approved_items) && result.approved_items.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Approved Items</div>
                            <div className="text-xs">
                              {result.approved_items.map((ai: any, i: number) => (
                                <div key={i}>{`${ai.procedure_code ?? ai.procedureCode ?? ''}${ai.approved_units ? ` — units: ${ai.approved_units}` : ''}`}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {result.expires_on && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Expires On</div>
                            <div className="text-xs">{String(result.expires_on)}</div>
                          </div>
                        )}
                        {result.comments && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Comments</div>
                            <div className="text-xs">{String(result.comments)}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Clinical documentation */}
                    {(normStage === 'clinical_documentation' || normStage === 'clinical-documentation') && result && (
                      <>
                        {result.doc_status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Doc Status</div>
                            <div className="text-xs">{String(result.doc_status)}</div>
                          </div>
                        )}
                        {result.missing_items && Array.isArray(result.missing_items) && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Missing Items</div>
                            <div className="text-xs">{result.missing_items.join(', ')}</div>
                          </div>
                        )}
                        {result.comments && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Comments</div>
                            <div className="text-xs">{String(result.comments)}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Medical coding */}
                    {(normStage === 'medical_coding' || normStage === 'medical-coding') && result && (
                      <>
                        {result.coding_status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Coding Status</div>
                            <div className="text-xs">{String(result.coding_status)}</div>
                          </div>
                        )}
                        {result.line_level_issues && Array.isArray(result.line_level_issues) && result.line_level_issues.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Line Level Issues</div>
                            <div className="text-xs">
                              {result.line_level_issues.map((li: any, i: number) => (
                                <div key={i}>{`Line ${li.line_index ?? i}: ${li.issue_code ?? li.description ?? JSON.stringify(li)}`}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {result.suggestions && Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Suggestions</div>
                            <div className="text-xs">{result.suggestions.join(', ')}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Claims scrubbing */}
                    {(normStage === 'claims_scrubbing' || normStage === 'claims-scrubbing') && result && (
                      <>
                        {result.scrub_status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Scrub Status</div>
                            <div className="text-xs">{String(result.scrub_status)}</div>
                          </div>
                        )}
                        {result.tracking_id !== undefined && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Tracking ID</div>
                            <div className="text-xs">{String(result.tracking_id ?? result.trackingId ?? '-')}</div>
                          </div>
                        )}
                        {result.errors && Array.isArray(result.errors) && result.errors.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Errors</div>
                            <div className="text-xs">
                              {result.errors.map((er: any, i: number) => (
                                <div key={i}>{`${er.field ?? ''}${er.error_code ? ` [${er.error_code}]` : ''}${er.message ? `: ${er.message}` : ''}`}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {result.warnings && Array.isArray(result.warnings) && result.warnings.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Warnings</div>
                            <div className="text-xs">{result.warnings.join(', ')}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Claims submission */}
                    {(normStage === 'claims_submission' || normStage === 'claims-submission') && result && (
                      <>
                        {result.submission_status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Submission Status</div>
                            <div className="text-xs">{String(result.submission_status)}</div>
                          </div>
                        )}
                        {result.claim_ref_id && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Claim Ref ID</div>
                            <div className="text-xs">{String(result.claim_ref_id)}</div>
                          </div>
                        )}
                        {result.ack_timestamp && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Ack Timestamp</div>
                            <div className="text-xs">{String(result.ack_timestamp)}</div>
                          </div>
                        )}
                        {result.queued_position !== undefined && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Queued Position</div>
                            <div className="text-xs">{String(result.queued_position)}</div>
                          </div>
                        )}
                        {result.comments && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Comments</div>
                            <div className="text-xs">{String(result.comments)}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Remittance tracking */}
                    {(normStage === 'remittance' || normStage === 'remittance_tracking' || normStage === 'remittance-tracking') && result && (
                      (() => {
                        // support both result.Remittance wrapper and direct fields
                        const rem = result.Remittance ?? result;
                        return (
                          <>
                            {rem.RemitID && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Remit ID</div>
                                <div className="text-xs">{String(rem.RemitID)}</div>
                              </div>
                            )}
                            {rem.ClaimRefID && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Claim Ref ID</div>
                                <div className="text-xs">{String(rem.ClaimRefID)}</div>
                              </div>
                            )}
                            {rem.RemitStatus && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Remit Status</div>
                                <div className="text-xs">{String(rem.RemitStatus)}</div>
                              </div>
                            )}
                            {rem.PaidAmount !== undefined && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Paid Amount</div>
                                <div className="text-xs">{String(rem.PaidAmount)}</div>
                              </div>
                            )}
                            {rem.Adjustments && Array.isArray(rem.Adjustments) && rem.Adjustments.length > 0 && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Adjustments</div>
                                <div className="text-xs">
                                  {rem.Adjustments.map((adj: any, i: number) => (
                                    <div key={i}>{`${adj.Code ?? adj.code ?? ''}${adj.Amount ? `: ${adj.Amount}` : ''}${adj.Description ? ` — ${adj.Description}` : ''}`}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {rem.DenialCodes && Array.isArray(rem.DenialCodes) && rem.DenialCodes.length > 0 && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Denial Codes</div>
                                <div className="text-xs">
                                  {rem.DenialCodes.map((dc: any, i: number) => <div key={i}>{`${dc.Code ?? dc.code ?? ''}${dc.Description ? `: ${dc.Description}` : ''}`}</div>)}
                                </div>
                              </div>
                            )}
                            {rem.PaymentDate && (
                              <div className="text-xs mb-1">
                                <div className="text-xs font-medium">Payment Date</div>
                                <div className="text-xs">{String(rem.PaymentDate)}</div>
                              </div>
                            )}
                          </>
                        );
                      })()
                    )}

                    {/* Denial management */}
                    {(normStage === 'denial_management' || normStage === 'denial-management') && result && (
                      <>
                        {result.denial_management_status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Denial Management Status</div>
                            <div className="text-xs">{String(result.denial_management_status)}</div>
                          </div>
                        )}
                        {result.appeal_ref_id && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Appeal Ref ID</div>
                            <div className="text-xs">{String(result.appeal_ref_id)}</div>
                          </div>
                        )}
                        {result.next_steps && Array.isArray(result.next_steps) && result.next_steps.length > 0 && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Next Steps</div>
                            <div className="text-xs">{result.next_steps.join(', ')}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Resubmit / claims_resubmission */}
                    {(normStage === 'claims_resubmission' || normStage === 'claims-resubmission' || normStage === 'resubmit') && result && (
                      <>
                        {result.resubmission_status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Resubmission Status</div>
                            <div className="text-xs">{String(result.resubmission_status)}</div>
                          </div>
                        )}
                        {result.new_claim_ref_id !== undefined && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">New Claim Ref ID</div>
                            <div className="text-xs">{String(result.new_claim_ref_id ?? '-')}</div>
                          </div>
                        )}
                        {result.comments && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Comments</div>
                            <div className="text-xs">{String(result.comments)}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Reconciliation */}
                    {(normStage === 'reconciliation') && result && (
                      <>
                        {result.recon_id && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Reconciliation ID</div>
                            <div className="text-xs">{String(result.recon_id)}</div>
                          </div>
                        )}
                        {result.status && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Status</div>
                            <div className="text-xs">{String(result.status)}</div>
                          </div>
                        )}
                        {result.settlement_amount !== undefined && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Settlement Amount</div>
                            <div className="text-xs">{String(result.settlement_amount)}</div>
                          </div>
                        )}
                        {result.notes && (
                          <div className="text-xs mb-1">
                            <div className="text-xs font-medium">Notes</div>
                            <div className="text-xs">{String(result.notes)}</div>
                          </div>
                        )}
                      </>
                    )}

                    {/* If nothing matched above and result has other keys, show first few key-values (as before) */}
                    {!patient && !claimRef && !priorAuthId && result && typeof result === 'object' && Object.keys(result).length > 0 && (
                      <div className="text-xs">
                        {Object.entries(result).slice(0, 6).map(([k, v]) => (
                          <div key={k}><span className="font-medium">{prettyLabel(k)}: </span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                        ))}
                      </div>
                    )}

                    {/* Summary removed intentionally to avoid duplicate tail-end JSON display */}
                  </div>
                </div>
              );
            })}

            {/* ===== New: Download button displayed below the previewed results ===== */}
            <div>
              <Button
                onClick={downloadResults}
                disabled={!resultsPreview || resultsPreview.length === 0}
                className="mt-2 w-full bg-gradient-primary hover:bg-brand-accent-2 text-white"
              >
                Download Results
              </Button>
            </div>
            {/* ===================================================================== */}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
