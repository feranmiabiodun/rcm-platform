import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboSearchInput } from '../ComboSearchInput';
import { useRCM } from '@/contexts/RCMContext';
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
import { buildUrl } from '@/config/api'; // retained for debugging / parity with config

interface PatientDetailsFormProps {
  categoryId: string;
  optionId: string;
}

// Updated field map: fields added/asterisked to match the ingestion-required keys
const getRequiredFields = (categoryId: string) => {
  const fieldMap: Record<string, Array<{name: string, label: string, type: string, required?: boolean}>> = {
    'check-eligibility': [
      { name: 'claimId', label: 'Claim ID', type: 'text', required: true },
      { name: 'memberId', label: 'Member ID', type: 'text', required: true },
      { name: 'nationalId', label: 'National ID', type: 'text' },
      { name: 'policyNumber', label: 'Policy Number', type: 'text' },
      { name: 'payer', label: 'Payer', type: 'payer' },
      { name: 'dateOfService', label: 'Date of Service', type: 'date' }
    ],
    'prior-authorization': [
      { name: 'requestId', label: 'Request ID', type: 'text', required: true },
      { name: 'memberId', label: 'Member ID', type: 'text' },
      { name: 'nationalId', label: 'National ID', type: 'text' },
      { name: 'payer', label: 'Payer', type: 'payer' },
      { name: 'procedureCode', label: 'Procedure Code', type: 'text' },
      { name: 'procedureDescription', label: 'Procedure Description', type: 'text' },
      { name: 'requestingProvider', label: 'Requesting Provider', type: 'text' }
    ],
    'clinical-documentation': [
      { name: 'procedureCode', label: 'Procedure Code', type: 'text', required: true },
      { name: 'clinicianId', label: 'Clinician ID', type: 'text' },
      { name: 'claimId', label: 'Claim ID', type: 'text' },
      { name: 'patientId', label: 'Patient ID', type: 'text' }
    ],
    'medical-coding': [
      { name: 'claimId', label: 'Claim ID', type: 'text', required: true },
      { name: 'patientId', label: 'Patient ID', type: 'text' },
      { name: 'dateOfService', label: 'Date of Service', type: 'date' }
    ],
    'claims-scrubbing': [
      { name: 'claimId', label: 'Claim ID (External ID)', type: 'text', required: true },
      { name: 'patientId', label: 'Patient ID', type: 'text' },
      { name: 'providerNPI', label: 'Provider NPI', type: 'text' },
      { name: 'payer', label: 'Payer', type: 'payer' }
    ],
    'claims-submission': [
      { name: 'claimId', label: 'Claim ID', type: 'text', required: true },
      { name: 'providerNPI', label: 'Provider NPI', type: 'text' },
      { name: 'facilityId', label: 'Facility ID', type: 'text' },
      { name: 'payer', label: 'Payer', type: 'payer' }
    ],
    'remittance': [
      { name: 'paymentReference', label: 'Remit ID / Payment Reference', type: 'text', required: true },
      { name: 'claimId', label: 'Claim Ref ID', type: 'text', required: true },
      { name: 'payer', label: 'Payer', type: 'payer' }
    ],
    'denial-management': [
      { name: 'claimId', label: 'Claim ID (ClaimRefID)', type: 'text', required: true },
      { name: 'payer', label: 'Payer', type: 'payer' }
    ],
    'resubmit': [
      { name: 'originalSubmissionId', label: 'Original Submission ID', type: 'text', required: true },
      { name: 'claimId', label: 'Claim ID', type: 'text' },
      { name: 'payer', label: 'Payer', type: 'payer' }
    ],
    'reconciliation': [
      { name: 'reconId', label: 'Reconciliation ID', type: 'text', required: true },
      { name: 'claimId', label: 'Claim ID', type: 'text' },
      { name: 'paymentReference', label: 'Payment Reference', type: 'text' }
    ]
  };

  return fieldMap[categoryId] || [];
};

export const PatientDetailsForm: React.FC<PatientDetailsFormProps> = ({ categoryId, optionId }) => {
  // keep RCM context available (not destructuring lookup-specific props)
  const rcm = useRCM();

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Result preview (no download button)
  const [resultsPreview, setResultsPreview] = useState<Array<Record<string, unknown>> | null>(null);

  const fields = getRequiredFields(categoryId);

  const handleInputChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (validationErrors.length > 0) setValidationErrors([]);
  };

  // Validation tailored to ingestion-required keys (matches PatientDataUpload isEndpointReadyPayload)
  const validateForm = () => {
    const errors: string[] = [];

    switch (categoryId) {
      case 'check-eligibility':
        if (!formData.claimId?.trim()) errors.push('Claim ID is required');
        if (!formData.memberId?.trim()) errors.push('Member ID is required');
        return errors;

      case 'prior-authorization':
        if (!formData.requestId?.trim()) errors.push('Request ID is required');
        return errors;

      case 'clinical-documentation':
        if (!formData.procedureCode?.trim() && !formData.clinicianId?.trim()) {
          errors.push('Procedure Code or Clinician ID is required');
        }
        return errors;

      case 'medical-coding':
        if (!formData.claimId?.trim()) errors.push('Claim ID is required');
        return errors;

      case 'claims-scrubbing':
        if (!formData.claimId?.trim()) errors.push('Claim ID (External ID) is required');
        return errors;

      case 'claims-submission':
        if (!formData.claimId?.trim()) errors.push('Claim ID is required');
        return errors;

      case 'remittance':
        if (!formData.paymentReference?.trim()) errors.push('Payment Reference / Remit ID is required');
        if (!formData.claimId?.trim()) errors.push('Claim Ref ID is required');
        return errors;

      case 'denial-management':
        if (!formData.claimId?.trim()) errors.push('Claim ID (ClaimRefID) is required');
        return errors;

      case 'resubmit':
        if (!formData.originalSubmissionId?.trim()) errors.push('Original Submission ID is required');
        return errors;

      case 'reconciliation':
        if (!formData.reconId?.trim()) errors.push('Reconciliation ID is required');
        return errors;

      default:
        const hasIdentifier = Boolean(formData.memberId || formData.nationalId || formData.claimId || formData.patientId || formData.policyNumber);
        if (!hasIdentifier) {
          errors.push('At least one identifier is required (Member ID, National ID, Claim ID, Patient ID, or Policy Number)');
        }
        return errors;
    }
  };

  // Build the payload array in the same shape PatientDataUpload uses
  const buildPayloadForStage = (cat: string, fd: Record<string, string>) => {
    switch (String(cat).toLowerCase()) {
      case 'check-eligibility':
      case 'check_eligibility':
        return [{
          Claim: {
            ID: String(fd.claimId ?? ''),
            MemberID: String(fd.memberId ?? '')
          }
        }];

      case 'prior-authorization':
      case 'prior_authorization':
        const pa: any = {};
        if (fd.requestId) pa.RequestID = String(fd.requestId);
        if (fd.memberId) pa.MemberID = String(fd.memberId);
        if (fd.procedureCode) pa.ProcedureCodes = [String(fd.procedureCode)];
        if (fd.requestingProvider) pa.RequestingProvider = String(fd.requestingProvider);
        return [{ PriorAuthorizationRequest: pa }];

      case 'clinical-documentation':
      case 'clinical_documentation':
        const cd: any = {};
        if (fd.procedureCode) cd.ProcedureCode = String(fd.procedureCode);
        if (fd.clinicianId) cd.ClinicianID = String(fd.clinicianId);
        return [{ ClinicalDocument: cd }];

      case 'medical-coding':
      case 'medical_coding':
        return [{ Claim: { ID: String(fd.claimId ?? '') } }];

      case 'claims-scrubbing':
      case 'claims_scrubbing':
        if (fd.claimId) return [{ Claim: { ExternalID: String(fd.claimId) } }];
        return [{ Claim: {} }];

      case 'claims-submission':
      case 'claims_submission':
        return [{ ClaimSubmission: { ClaimID: String(fd.claimId ?? '') } }];

      case 'remittance':
        return [{ Remittance: { RemitID: String(fd.paymentReference ?? ''), ClaimRefID: String(fd.claimId ?? '') } }];

      case 'denial-management':
      case 'denial_management':
        return [{ Denial: { ClaimRefID: String(fd.claimId ?? '') } }];

      case 'resubmit':
        return [{ Resubmission: { OriginalClaimRefID: String(fd.originalSubmissionId ?? ''), OriginalClaimID: String(fd.claimId ?? '') } }];

      case 'reconciliation':
        return [{ Reconciliation: { ReconID: String(fd.reconId ?? '') } }];

      default:
        return [fd];
    }
  };

  const mapCategoryToEndpointKey = (cat: string): string | null => {
    switch (String(cat).toLowerCase()) {
      case 'check-eligibility':
      case 'check_eligibility':
        return 'CHECK_ELIGIBILITY';
      case 'prior-authorization':
      case 'prior_authorization':
        return 'PRIOR_AUTH';
      case 'clinical-documentation':
      case 'clinical_documentation':
        return 'CLINICAL_DOCUMENT_UPLOAD';
      case 'medical-coding':
      case 'medical_coding':
        return 'MEDICAL_CODING';
      case 'claims-scrubbing':
      case 'claims_scrubbing':
        return 'CLAIMS_SCRUB';
      case 'claims-submission':
      case 'claims_submission':
        return 'CLAIMS_SUBMIT';
      case 'remittance':
        return 'REMITTANCE';
      case 'denial-management':
      case 'denial_management':
        return 'DENIAL_MANAGEMENT';
      case 'resubmit':
        return 'RESUBMIT';
      case 'reconciliation':
        return 'RECONCILIATION';
      default:
        return null;
    }
  };

  const handleSubmit = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setValidationErrors([]);

    try {
      // Build ingestion-like simulated result to show in preview (no backend call here)
      let simulatedResult: Record<string, unknown> = {};

      switch (categoryId) {
        case 'check-eligibility':
          simulatedResult = {
            outcome_code: 'ELG_SIM',
            outcome_label: 'Simulated',
            description: 'Simulated eligibility result',
            patient: {
              patient_id: formData.patientId ?? `SIM-${formData.claimId ?? 'UNKNOWN'}`,
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'prior-authorization':
          simulatedResult = {
            prior_auth_id: formData.requestId ?? `PA-SIM-${formData.memberId ?? 'X'}`,
            status_code: 'PA_SIM',
            status_label: 'Simulated Prior Auth',
            approved_items: formData.procedureCode ? [{ procedure_code: formData.procedureCode, approved_units: 1 }] : [],
            patient: {
              patient_id: formData.patientId ?? '',
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'clinical-documentation':
          simulatedResult = {
            doc_status: 'DOC_SIM',
            missing_items: [],
            comments: 'Simulated clinical documentation check',
            patient: {
              patient_id: formData.patientId ?? '',
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'medical-coding':
          simulatedResult = {
            coding_status: 'CODE_SIM',
            line_level_issues: [],
            suggestions: [],
            patient: {
              patient_id: formData.patientId ?? '',
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'claims-scrubbing':
          simulatedResult = {
            scrub_status: 'SCRUB_SIM',
            errors: [],
            warnings: [],
            tracking_id: `TID-SIM-${formData.claimId ?? 'X'}`,
            patient: {
              patient_id: formData.patientId ?? '',
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'claims-submission':
          simulatedResult = {
            submission_status: 'SUB_SIM',
            claim_ref_id: formData.claimId ?? `CLM-SIM-${Date.now()}`,
            ack_timestamp: new Date().toISOString(),
            queued_position: 0,
            comments: 'Simulated submission',
            patient: {
              patient_id: formData.patientId ?? '',
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'remittance':
          simulatedResult = {
            Remittance: {
              RemitID: formData.paymentReference ?? `RA-SIM-${Date.now()}`,
              ClaimRefID: formData.claimId ?? '',
              RemitStatus: 'RA_SIM',
              PaidAmount: formData.paidAmount ? Number(formData.paidAmount) : 0,
              Adjustments: [],
              DenialCodes: [],
              PaymentDate: formData.paymentDate ?? ''
            }
          };
          break;

        case 'denial-management':
          simulatedResult = {
            denial_management_status: 'DEN_MGR_SIM',
            next_steps: ['Analyze denial'],
            appeal_ref_id: `APPEAL-SIM-${Date.now()}`
          };
          break;

        case 'resubmit':
          simulatedResult = {
            resubmission_status: 'RESUB_SIM',
            new_claim_ref_id: `CLM-RES-SIM-${Date.now()}`,
            comments: 'Simulated resubmission accepted',
            patient: {
              patient_id: formData.patientId ?? '',
              name: formData.patientName ?? '',
              dob: formData.patientDob ?? ''
            }
          };
          break;

        case 'reconciliation':
          simulatedResult = {
            recon_id: formData.reconId ?? `RECON-SIM-${Date.now()}`,
            status: 'RECON_SIM',
            settlement_amount: formData.settlementAmount ? Number(formData.settlementAmount) : 0,
            notes: 'Simulated reconciliation'
          };
          break;

        default:
          simulatedResult = { ...formData };
          break;
      }

      const wrappedSimulated = {
        matched: true,
        stage: categoryId,
        result: simulatedResult
      };

      // --- Try backend via rcm context first (if available) ---
      let backendWrappedResult: Array<Record<string, any>> | null = null;
      try {
        const rcmAny = rcm as any;
        if (rcmAny && typeof rcmAny.submitStage === 'function') {
          const r = await rcmAny.submitStage(categoryId, formData);
          if (r) {
            if (Array.isArray(r)) backendWrappedResult = r;
            else if (r.matched || r.result || r.stage) backendWrappedResult = [r];
            else if (r.wrapped) backendWrappedResult = Array.isArray(r.wrapped) ? r.wrapped : [r.wrapped];
          }
        } else if (rcmAny && typeof rcmAny.runStage === 'function') {
          const r = await rcmAny.runStage(categoryId, formData);
          if (r) {
            if (Array.isArray(r)) backendWrappedResult = r;
            else if (r.matched || r.result || r.stage) backendWrappedResult = [r];
            else if (r.wrapped) backendWrappedResult = Array.isArray(r.wrapped) ? r.wrapped : [r.wrapped];
          }
        }
      } catch (e) {
        console.warn('RCM submit failed or not available:', e);
      }

      // --- If rcm didn't provide, call the same service helpers used by PatientDataUpload ---
      if (!backendWrappedResult) {
        try {
          const payloadArray = buildPayloadForStage(categoryId, formData);

          // Use the same services / wrappers the upload component uses.
          let response: any = null;
          switch (String(categoryId).toLowerCase()) {
            case 'check-eligibility':
            case 'check_eligibility':
              response = await checkEligibility(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'prior-authorization':
            case 'prior_authorization':
              response = await priorAuth(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'clinical-documentation':
            case 'clinical_documentation':
              response = await uploadClinicalDocument(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'medical-coding':
            case 'medical_coding':
              response = await medicalCoding(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'claims-scrubbing':
            case 'claims_scrubbing':
              response = await claimsScrub(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'claims-submission':
            case 'claims_submission':
              response = await claimsSubmit(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'remittance':
              response = await remittance(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'denial-management':
            case 'denial_management':
              response = await denialManagement(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'resubmit':
              response = await resubmit(payloadArray as unknown as Record<string, unknown>);
              break;
            case 'reconciliation':
              response = await reconciliation(payloadArray as unknown as Record<string, unknown>);
              break;
            default:
              response = await checkEligibility(payloadArray as unknown as Record<string, unknown>);
              break;
          }

          // Normalize axios / fetch responses (same logic as upload component)
          const data = (response && (response as any).data) ?? (response as any);
          if (Array.isArray(data)) {
            backendWrappedResult = data;
          } else {
            backendWrappedResult = [data];
          }
        } catch (e) {
          console.warn('[PatientDetailsForm] service call failed, falling back to simulated result:', e);
        }
      }

      // Use backend response if present, otherwise fallback to simulated
      if (backendWrappedResult && backendWrappedResult.length > 0) {
        setResultsPreview(backendWrappedResult);
      } else {
        setResultsPreview([wrappedSimulated]);
      }

      // small delay to mimic processing
      await new Promise(resolve => setTimeout(resolve, 400));
    } catch (e) {
      console.error('Submission failed:', e);
      setValidationErrors(['Submission failed. See console for details.']);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Form Fields */}
      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={field.name} className="text-sm font-medium text-brand-charcoal">
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>

            {field.type === 'payer' ? (
              <ComboSearchInput
                value={formData[field.name] || ''}
                onValueChange={(value) => handleInputChange(field.name, value)}
                placeholder="Select or search payer..."
              />
            ) : field.type === 'date' ? (
              <Input
                id={field.name}
                type="date"
                value={formData[field.name] || ''}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                className="bg-brand-panel"
              />
            ) : (
              <Input
                id={field.name}
                type="text"
                value={formData[field.name] || ''}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="bg-brand-panel"
              />
            )}
          </div>
        ))}
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert className="border-destructive bg-destructive/10">
          <AlertDescription>
            <ul className="text-sm space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index} className="text-destructive">• {error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Submit Button */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || validationErrors.length > 0}
        className="w-full bg-gradient-primary hover:bg-brand-accent-2 text-white"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Processing...
          </>
        ) : (
          'Submit'
        )}
      </Button>

      {/* Result Preview (mapped and formatted exactly like PatientDataUpload.tsx) */}
      {resultsPreview && resultsPreview.length > 0 && (
        <div className="mt-4">
          <div className="bg-brand-panel border-border rounded">
            <div className="p-3 border-b border-border flex items-center gap-2">
              <FileTextIconReplacement />
              <div className="text-sm font-medium text-brand-charcoal">Result Preview</div>
            </div>

            <div className="p-3 space-y-3">
              {resultsPreview.map((item, idx) => {
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
                      {/* Patient block */}
                      {patient && (
                        <div className="mb-1">
                          <div className="text-xs font-medium">Patient</div>
                          <div className="text-xs">{`ID: ${patient.patient_id ?? patient.patientId ?? patient.id ?? '-'}`}</div>
                          <div className="text-xs">{`Name: ${patient.name ?? '-'}`}</div>
                          <div className="text-xs">{`DOB: ${patient.dob ?? '-'}`}</div>
                        </div>
                      )}

                      {/* Claim Ref */}
                      {claimRef && (
                        <div className="text-xs mb-1">
                          <div className="text-xs font-medium">Claim Ref</div>
                          <div className="text-xs">{String(claimRef)}</div>
                        </div>
                      )}

                      {/* Prior Auth */}
                      {priorAuthId && (
                        <div className="text-xs mb-1">
                          <div className="text-xs font-medium">Prior Auth</div>
                          <div className="text-xs">{String(priorAuthId)}</div>
                        </div>
                      )}

                      {/* Stage-specific additional fields (copied from PatientDataUpload) */}

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

                      {/* Note: summary block intentionally removed */}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ----------------- small local helpers (kept in-file to avoid changing imports) ----------------- */

function prettyLabel(key: any) {
  return String(key)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_\.]+/g, ' ')
    .replace(/^./, s => String(s).toUpperCase())
    .trim();
}

function FileTextIconReplacement() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
