type RateLimitRecord = {
  count: number;
  windowStartedAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

type RateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
};

const DEFAULT_LIMIT = 8;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 5_000;

/** In-process, best-effort protection; distributed deployments need a shared store. */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const records = new Map<string, RateLimitRecord>();

  function prune(currentTime: number): void {
    if (records.size < maxEntries) return;
    for (const [key, record] of records) {
      if (currentTime - record.windowStartedAt >= windowMs) records.delete(key);
    }
    while (records.size >= maxEntries) {
      const oldestKey = records.keys().next().value as string | undefined;
      if (!oldestKey) break;
      records.delete(oldestKey);
    }
  }

  return {
    check(key: string): RateLimitResult {
      const currentTime = now();
      const existing = records.get(key);
      if (!existing || currentTime - existing.windowStartedAt >= windowMs) {
        prune(currentTime);
        records.set(key, { count: 1, windowStartedAt: currentTime });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const remainingMs = Math.max(0, windowMs - (currentTime - existing.windowStartedAt));
      if (existing.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1_000)) };
      }

      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export function clientRateLimitKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const candidate = forwarded || realIp || 'unknown';
  return candidate.slice(0, 128) || 'unknown';
}
