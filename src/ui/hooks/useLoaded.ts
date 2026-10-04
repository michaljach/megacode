import { useEffect, useState } from "react";

/** Runs `load` once on mount; undefined until it resolves. */
export function useLoaded<T>(load: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    load().then((v) => live && setValue(v));
    return () => void (live = false);
  }, []);
  return value;
}
