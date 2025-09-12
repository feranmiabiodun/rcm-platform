// main.tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setApiBase } from "@/services/apiClient";

/* Dev startup: configure axios base from Vite env (falls back to local backend).
   This runs inside the app module so import.meta.env is available.
   We sanitize and validate the value to avoid "Invalid URL" errors. */
function sanitizeApiBase(raw?: string | null | undefined): string | null {
  if (!raw) return null;
  // Trim whitespace
  let s = String(raw).trim();

  // Remove accidental trailing dots or slashes: "http://1.2.3.4:8000." -> "http://1.2.3.4:8000"
  while (s.endsWith(".") || s.endsWith("/")) {
    s = s.slice(0, -1);
  }

  // If scheme missing, assume http (unlikely for VITE value but safe)
  if (!/^https?:\/\//i.test(s)) {
    s = `http://${s}`;
  }

  // Validate using URL constructor
  try {
    // Will throw for invalid urls
    // eslint-disable-next-line no-new
    new URL(s);
    return s;
  } catch (err) {
    // invalid — return null for caller to handle fallback
    // eslint-disable-next-line no-console
    console.warn("sanitizeApiBase: invalid API base after sanitization:", s, err);
    return null;
  }
}

try {
  const viteApiBase = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) ?? undefined;
  // eslint-disable-next-line no-console
  console.log(">>> ENTRY: raw VITE_API_BASE =", viteApiBase);

  const sanitized = sanitizeApiBase(viteApiBase);
  if (sanitized) {
    // eslint-disable-next-line no-console
    console.log(">>> ENTRY: using sanitized VITE_API_BASE =", sanitized);
    setApiBase(sanitized);
  } else {
    // fallback for local/dev machine (explicit)
    const fallback = "http://192.168.44.109:8000";
    // eslint-disable-next-line no-console
    console.warn(`>>> ENTRY: VITE_API_BASE invalid or missing; falling back to ${fallback}`);
    setApiBase(fallback);
  }
} catch (e) {
  // ignore errors in environments without import.meta or console
  // eslint-disable-next-line no-console
  console.error(">>> ENTRY: unexpected error when setting API base:", e);
}

createRoot(document.getElementById("root")!).render(<App />);
