/**
 * src/services/api.ts
 * Typed wrappers for backend endpoints (lint-friendly, no 'any').
 *
 * Each function returns Promise<{ status, data }>. Rejections are normalized objects:
 * { status: number, message: string, data?: unknown, originalError?: unknown }.
 */

import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { apiClient } from "./apiClient";
import { ENDPOINTS, buildUrl } from "../config/api";

export type ApiResult<T = unknown> = { status: number; data: T };
export type ApiError = { status: number; message: string; data?: unknown; originalError?: unknown };

export type RequestOpts = {
  signal?: AbortSignal;
  retries?: number;
  headers?: Record<string, string>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Safe extractor for string message fields from various possible response shapes */
function extractMessageFromResponse(responseData: unknown): string | null {
  if (responseData && typeof responseData === "object") {
    const r = responseData as Record<string, unknown>;
    if (typeof r.message === "string") return r.message;
    if (typeof r.error === "string") return r.error;
    // some backends return { errors: [{ message: "..." }] }
    if (Array.isArray(r.errors) && r.errors.length > 0 && typeof r.errors[0] === "object") {
      const first = r.errors[0] as Record<string, unknown>;
      if (typeof first.message === "string") return first.message;
    }
  }
  return null;
}

async function requestWithRetry<T = unknown>({
  method,
  url,
  params,
  data,
  headers,
  retries,
  signal,
  isForm,
}: {
  method?: "get" | "post" | "put" | "delete";
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  signal?: AbortSignal;
  isForm?: boolean;
}): Promise<ApiResult<T>> {
  const finalUrl = buildUrl(url);
  const defaultMethod = data ? "post" : "get";
  const m = (method || defaultMethod).toLowerCase() as "get" | "post" | "put" | "delete";

  const maxRetries = typeof retries === "number" ? retries : (m === "get" ? 2 : 0);
  let attempt = 0;

  // loop with exponential backoff for retryable errors
  while (true) {
    try {
      const config: AxiosRequestConfig = {
        method: m,
        url: finalUrl,
        params: params ?? undefined,
        data: data ?? undefined,
        headers: headers ?? undefined,
        signal: signal ?? undefined,
      };

      if (isForm && config.headers) {
        // Let browser set multipart boundary
        delete (config.headers as Record<string, string>)["Content-Type"];
      }

      const res = await apiClient.request(config);
      return { status: res.status, data: res.data as T };
    } catch (errUnknown) {
      const err = errUnknown as AxiosError;

      // Cancellation or Abort -> normalized
      if (axios.isCancel(err) || (err as Error).name === "AbortError") {
        throw { status: 0, message: "Request canceled", originalError: err } as ApiError;
      }

      // Prefer response.status when available; otherwise treat as network/server error
      const status: number | null = err?.response?.status ?? null;
      const isNetworkError = !status || status >= 500 || status === 0;

      // If not retryable or retries exhausted -> normalize and throw
      if (attempt >= maxRetries || !isNetworkError) {
        const responseData = err?.response?.data;
        const extracted = extractMessageFromResponse(responseData);
        const message = extracted ?? (err.message ?? "Request failed");
        throw { status: status ?? 0, message, data: responseData, originalError: err } as ApiError;
      }

      // else wait and retry
      attempt += 1;
      const backoff = Math.min(1000 * 2 ** attempt, 10000);
      const jitter = Math.floor(Math.random() * 300);
      await sleep(backoff + jitter);
    }
  }
}

/* ---------------- endpoint wrappers ---------------- */

export async function checkEligibility<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.CHECK_ELIGIBILITY,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function checkEligibilityDb<T = unknown>(query: Record<string, unknown> = {}, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "get",
    url: ENDPOINTS.CHECK_ELIGIBILITY_DB,
    params: query,
    retries: opts.retries ?? 2,
    signal: opts.signal,
  });
}

export async function priorAuth<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.PRIOR_AUTH,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function uploadClinicalDocument<T = unknown>(formData: FormData | unknown, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.CLINICAL_DOCUMENT_UPLOAD,
    data: formData,
    isForm: true,
    headers: opts.headers ?? {},
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function medicalCoding<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.MEDICAL_CODING,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function claimsScrub<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.CLAIMS_SCRUB,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function claimsSubmit<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.CLAIMS_SUBMIT,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function remittance<T = unknown>(query: Record<string, unknown> = {}, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "get",
    url: ENDPOINTS.REMITTANCE,
    params: query,
    retries: opts.retries ?? 2,
    signal: opts.signal,
  });
}

export async function denialManagement<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.DENIAL_MANAGEMENT,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function resubmit<T = unknown>(payload: Record<string, unknown>, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "post",
    url: ENDPOINTS.RESUBMIT,
    data: payload,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    retries: opts.retries ?? 0,
    signal: opts.signal,
  });
}

export async function reconciliation<T = unknown>(query: Record<string, unknown> = {}, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "get",
    url: ENDPOINTS.RECONCILIATION,
    params: query,
    retries: opts.retries ?? 2,
    signal: opts.signal,
  });
}

export async function patientLookup<T = unknown>(query: Record<string, unknown> = {}, opts: RequestOpts = {}): Promise<ApiResult<T>> {
  return requestWithRetry<T>({
    method: "get",
    url: ENDPOINTS.PATIENT_LOOKUP,
    params: query,
    retries: opts.retries ?? 2,
    signal: opts.signal,
  });
}

/* re-exports for advanced control */
export { setApiBase, setAuthToken, clearAuthToken } from "./apiClient";
