export interface Category {
  id: string;
  label: string;
  subtitle: string;
}

export interface PatientOption {
  id: string;
  title: string;
  type: 'manual' | 'upload' | 'action';
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'select' | 'date' | 'textarea' | 'file';
  required?: boolean;
  options?: string[];
}

export interface PayerSeed {
  id: string;
  name: string;
  displayName: string;
}

export interface PatientLookupResponse {
  patientId: string;
  name: string;
  dateOfBirth: string;
  memberId?: string;
  nationalId?: string;
  policyNumber?: string;
  payer?: string;
}

/**
 * Generic API response shape.
 * Use ApiResponse<MyDataType> when you know the expected `data` shape.
 * Defaults to ApiResponse<unknown> to preserve safety for callers that don't specify a type.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  issues?: Array<{
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    suggestedFix?: string;
  }>;
}
