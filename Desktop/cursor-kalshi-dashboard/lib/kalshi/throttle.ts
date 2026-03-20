/**
 * Central request queue so we never exceed ~20 reads/sec (Basic tier).
 * Requests run sequentially with a minimum gap between starts.
 */
const MIN_INTERVAL_MS = 55; // ~18/sec sustained; small headroom under 20/s

type Job<T> = {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

const queue: Job<unknown>[] = [];
let processing = false;

async function pump(): Promise<void> {
  if (processing) return;
  processing = true;
  let lastStart = 0;
  while (queue.length) {
    const wait = Math.max(0, lastStart + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    const job = queue.shift();
    if (!job) break;
    lastStart = Date.now();
    try {
      const result = await job.run();
      job.resolve(result);
    } catch (e) {
      job.reject(e);
    }
  }
  processing = false;
}

export function enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: fn as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    void pump();
  });
}
