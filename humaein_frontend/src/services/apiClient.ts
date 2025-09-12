/**
 * src/services/apiClient.ts
 *
 * Production-ready Axios instance:
 * - Uses InternalAxiosRequestConfig for the interceptor parameter type to match axios expectations.
 * - Attaches Authorization header per-request from in-memory token (no defaults.headers mutation).
 * - setAuthToken persists token in-memory + localStorage only.
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { API_BASE } from "../config/api";

/**
 * Debug: print the Vite env var (if available) so you can verify the client is
 * picking up the runtime / build-time API base. Wrapped in try/catch so this
 * file remains safe in environments where `import.meta` or `console` may not exist.
 */
try {
  // Prefer the Vite-provided env var when available; fall back to API_BASE.
  // `import.meta` exists in the browser/Vite environment; the guard prevents SSR errors.
  // eslint-disable-next-line no-console
  console.log(
    ">>> VITE env (import.meta.env.VITE_API_BASE) =",
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) ?? API_BASE
  );
} catch {
  // noop in environments where import.meta or console is not available
}

let inMemoryToken: string | null = null;

/** axios instance with sane defaults */
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 20_000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

/** Debug: log the axios baseURL at runtime (useful to verify API_BASE was applied). */
try {
  // eslint-disable-next-line no-console
  console.log(">>> apiClient baseURL:", apiClient.defaults.baseURL);
} catch {
  // noop
}

/**
 * Request interceptor:
 * - Accepts InternalAxiosRequestConfig (correct axios internal type).
 * - Produces a plain writable headers object, sets Authorization if token exists,
 *   and assigns it back to config.headers in a form axios accepts.
 */
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Prefer the in-memory token; fallback to localStorage
    const token = inMemoryToken ?? (() => {
      try {
        return localStorage.getItem("authToken");
      } catch {
        return null;
      }
    })();

    // Normalize existing headers (which may be AxiosHeaders, undefined, or plain object)
    // -> produce a plain Record<string,string> we can safely mutate
    const rawHeaders = (config.headers as unknown) as Record<string, unknown> | undefined;
    const writableHeaders: Record<string, string> = {};

    if (rawHeaders && typeof rawHeaders === "object") {
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") writableHeaders[k] = v;
        else if (v != null) writableHeaders[k] = String(v);
      }
    }

    // Set or remove Authorization
    if (token) {
      writableHeaders.Authorization = `Bearer ${token}`;
    } else if ("Authorization" in writableHeaders) {
      delete writableHeaders.Authorization;
    }

    // Assign back to config.headers in the shape axios expects
    // Use the same config.headers slot (axios accepts a record or header instance)
    config.headers = writableHeaders as InternalAxiosRequestConfig["headers"];

    return config;
  },
  (error) => Promise.reject(error)
);

/** Response interceptor: normalize network / axios errors */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error || !error.config) {
      return Promise.reject({
        status: 0,
        message: error?.message ?? "Unknown error",
        originalError: error,
      });
    }
    if (!error.response) {
      return Promise.reject({
        status: 0,
        message: error.message ?? "Network error",
        originalError: error,
      });
    }
    const { status, data } = error.response;
    return Promise.reject({
      status,
      data,
      message: (data && (data.message || data.error)) || error.message || "Request failed",
      originalError: error,
    });
  }
);

/**
 * Set token in-memory and persist to localStorage (does NOT modify axios.defaults.headers).
 */
export function setAuthToken(token?: string | null): void {
  inMemoryToken = token ?? null;

  try {
    if (token) localStorage.setItem("authToken", token);
    else localStorage.removeItem("authToken");
  } catch {
    // ignore localStorage errors (SSR or restricted envs)
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}

/** Change runtime base URL (useful for QA/env switching) */
export function setApiBase(url: string): void {
  apiClient.defaults.baseURL = url;
}
