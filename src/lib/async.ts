/** Rejects with `Timed out` (or `message`) if the promise hasn't settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "Timed out"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
