/**
 * src/hooks/useApiMutation.ts
 * Typed hook to call any API function returning ApiResult<T>.
 */

import { useCallback, useRef, useState } from "react";
import type { ApiResult } from "../services/api";

export default function useApiMutation<TPayload = Record<string, unknown> | undefined, TResult = unknown>(
  apiFunction: (payload?: TPayload, opts?: unknown) => Promise<ApiResult<TResult>>
) {
  if (typeof apiFunction !== "function") {
    throw new Error("useApiMutation expects a function (apiFunction).");
  }

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TResult | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const mutate = useCallback(
    async (payload?: TPayload, opts: { cancelPrevious?: boolean } & Record<string, unknown> = {}) => {
      if (opts.cancelPrevious && abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {
          // ignore
        }
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const result = await apiFunction(payload, { ...opts, signal: controller.signal } as unknown);
        setData(result.data ?? (result as unknown as TResult));
        setLoading(false);
        return result;
      } catch (err) {
        setError(err as unknown);
        setLoading(false);
        throw err;
      } finally {
        abortControllerRef.current = null;
      }
    },
    [apiFunction]
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {
        // ignore
      }
      abortControllerRef.current = null;
      setLoading(false);
    }
  }, []);

  return { mutate, data, error, loading, cancel } as const;
}
