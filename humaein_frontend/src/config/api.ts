// src/config/api.ts
/**
 * Lint-safe API configuration using multiple resolution sources:
 * 1. Vite runtime: import.meta.env.VITE_API_BASE (available in dev and production bundles built by Vite)
 * 2. Build-time env: process.env.REACT_APP_API_BASE (CRA) or process.env.VITE_API_BASE
 * 3. Fallback: http://127.0.0.1:8000
 *
 * Using import.meta.env at module load ensures the axios instance created
 * using this value will use the correct baseURL in the browser.
 */

const runtimeViteBase =
  typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE
    ? String((import.meta as any).env.VITE_API_BASE)
    : undefined;

const reactAppBase =
  typeof process !== "undefined" && typeof process.env !== "undefined"
    ? (process.env.REACT_APP_API_BASE as string | undefined)
    : undefined;

const viteBuildBase =
  typeof process !== "undefined" && typeof process.env !== "undefined"
    ? (process.env.VITE_API_BASE as string | undefined)
    : undefined;

/**
 * Final resolution order:
 * 1. runtimeViteBase (import.meta.env) — highest priority for dev & built Vite bundles
 * 2. reactAppBase (CRA)
 * 3. viteBuildBase (build-time env)
 * 4. fallback
 */
export const API_BASE: string =
  runtimeViteBase || reactAppBase || viteBuildBase || "http://127.0.0.1:8000";

/**
 * ENDPOINTS: keep these as path-only values (leading slash included where appropriate).
 * buildUrl() below will join them to API_BASE properly.
 */
export const ENDPOINTS = {
  CHECK_ELIGIBILITY: "/simulator/humaein/eligibility",
  CHECK_ELIGIBILITY_DB: "/simulator/humaein/eligibility/fetch_db",
  PRIOR_AUTH: "/simulator/humaein/prior_auth",
  CLINICAL_DOCUMENT_UPLOAD: "/simulator/humaein/clinical_documentation",
  MEDICAL_CODING: "/simulator/humaein/medical_coding",
  CLAIMS_SCRUB: "/simulator/humaein/claims_scrubbing",
  CLAIMS_SUBMIT: "/simulator/humaein/claims_submission",
  REMITTANCE: "/simulator/humaein/remittance_tracking",
  DENIAL_MANAGEMENT: "/simulator/humaein/denial_management",
  RESUBMIT: "/simulator/humaein/resubmit",
  RECONCILIATION: "/simulator/humaein/reconciliation",
  PATIENT_LOOKUP: "/simulator/humaein/patient_lookup", // if you removed this, adapt callers
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

function joinBaseAndPath(base: string, path: string): string {
  // Ensure exactly one '/' between base and path.
  // Normalize base (remove trailing '/') and normalize path (ensure leading '/')
  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * buildUrl: accepts EndpointKey, raw path, or full URL and returns full URL string.
 */
export function buildUrl(endpointOrPath: EndpointKey | string): string {
  if (!endpointOrPath) throw new Error("buildUrl requires an endpoint key or path");

  const asString = String(endpointOrPath);

  if (/^https?:\/\//i.test(asString)) return asString;

  if (Object.prototype.hasOwnProperty.call(ENDPOINTS, asString)) {
    const val = ENDPOINTS[asString as EndpointKey];
    return joinBaseAndPath(API_BASE, val);
  }

  const rawPath = asString.startsWith("/") ? asString : `/${asString}`;
  return joinBaseAndPath(API_BASE, rawPath);
}
