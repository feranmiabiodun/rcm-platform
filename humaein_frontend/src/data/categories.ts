import { Category } from '@/types/rcm';

export const CATEGORIES: Category[] = [
  {
    id: 'check-eligibility',
    label: 'Check Eligibility',
    subtitle: 'Verify coverage, benefits and co-pay.'
  },
  {
    id: 'prior-authorization',
    label: 'Prior Authorization',
    subtitle: 'Request pre-authorizations with clinical justification.'
  },
  {
    id: 'clinical-documentation',
    label: 'Clinical Documentation',
    subtitle: 'Upload clinical documents and tag them.'
  },
  {
    id: 'medical-coding',
    label: 'Medical Coding',
    subtitle: 'Apply and validate ICD/CPT codes.'
  },
  {
    id: 'claims-scrubbing',
    label: 'Claims Scrubbing',
    subtitle: 'Run rule-based scrubbing and identify issues.'
  },
  {
    id: 'claims-submission',
    label: 'Claims Submission',
    subtitle: 'Submit claims to payers (single & batch).'
  },
  {
    id: 'remittance',
    label: 'Remittance',
    subtitle: 'Ingest remittance advices and extract payment lines.'
  },
  {
    id: 'denial-management',
    label: 'Denial Management',
    subtitle: 'Log denials and manage appeals.'
  },
  {
    id: 'resubmit',
    label: 'Resubmit',
    subtitle: 'Resubmit corrected claims.'
  },
  {
    id: 'reconciliation',
    label: 'Reconciliation',
    subtitle: 'Match payments to claims and reconcile ledgers.'
  }
];