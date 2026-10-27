import { useCallback, useEffect, useState } from "react";

export type ApiData<T> =
  | { status: "loading"; reload: () => void }
  | { status: "error"; error: string; reload: () => void }
  | { status: "ready"; data: T; reload: () => void };

/** Fetch data on mount; `reload()` fetches again (e.g. after placing an order). */
export function useApi<T>(fetcher: () => Promise<T>): ApiData<T> {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T }
  >({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetcher().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (error: unknown) =>
        !cancelled && setState({ status: "error", error: error instanceof Error ? error.message : "Request failed" }),
    );
    return () => {
      cancelled = true;
    };
    // The fetcher is a stable module function; `version` triggers reloads.
  }, [version]);

  return { ...state, reload } as ApiData<T>;
}
