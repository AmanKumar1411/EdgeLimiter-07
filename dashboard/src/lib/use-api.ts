import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./format";

/**
 * Loads data on mount, whenever `key` changes, on `reload()`, and every
 * `refreshMs` if given. `key` must change whenever the loader's inputs do
 * (e.g. "policies:acme"); responses for an outdated key are ignored.
 */
export function useApi<T>(key: string, load: () => Promise<T>, refreshMs?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  });

  useEffect(() => {
    let current = true;

    async function run() {
      try {
        const value = await latestLoad.current();
        if (current) {
          setData(value);
          setError(undefined);
        }
      } catch (err) {
        if (current) setError(errorMessage(err));
      } finally {
        if (current) setLoading(false);
      }
    }

    setLoading(true);
    run();
    const timer = refreshMs ? setInterval(run, refreshMs) : undefined;
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [key, refreshMs, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return { data, error, loading, reload };
}
