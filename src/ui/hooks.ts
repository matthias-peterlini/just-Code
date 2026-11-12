import { useEffect, useState } from 'react';

/** Frame counter ticking every `ms` while `active`. */
export function useTick(ms: number, active = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return n;
}
