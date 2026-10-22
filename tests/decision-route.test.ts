import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionRoute } from '../src/lib/decision-route';
import { createRateLimiter } from '../src/lib/rate-limit';
import type { DecisionPayload } from '../src/lib/decision-service';

const payload = {
  generatedAt: '2026-01-15T12:00:00.000Z',
  source: 'Binance.US',
  decision: {},
} as DecisionPayload;

test('Decision endpoint returns a cacheable public 200 response', async () => {
  const GET = createDecisionRoute({ getDecision: async () => payload, rateLimiter: createRateLimiter() });
  const response = await GET(new Request('http://localhost/api/decision'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, s-maxage=60, stale-while-revalidate=60');
  assert.deepEqual(await response.json(), payload);
});

test('Decision endpoint returns 429 with Retry-After when its limiter rejects a request', async () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 1_000 });
  const GET = createDecisionRoute({ rateLimiter: limiter, getDecision: async () => payload });
  await GET(new Request('http://localhost/api/decision'));
  const response = await GET(new Request('http://localhost/api/decision'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('Decision endpoint returns a no-store 503 when its dependency fails', async () => {
  const GET = createDecisionRoute({
    getDecision: async () => { throw new Error('provider outage'); },
    rateLimiter: createRateLimiter(),
    logError: () => undefined,
  });
  const response = await GET(new Request('http://localhost/api/decision'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await response.json() as { error: string }).error, /temporarily unavailable/);
});
