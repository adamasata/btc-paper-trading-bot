import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter, clientRateLimitKey } from '../src/lib/rate-limit';


test('rate limiter enforces a per-key fixed window and resets after expiry', () => {
  let currentTime = 1_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => currentTime });

  assert.deepEqual(limiter.check('203.0.113.1'), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check('203.0.113.1'), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check('203.0.113.1'), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(limiter.check('203.0.113.2'), { allowed: true, retryAfterSeconds: 0 });

  currentTime += 1_000;
  assert.deepEqual(limiter.check('203.0.113.1'), { allowed: true, retryAfterSeconds: 0 });
});

test('rate-limit keys trust only the Vercel-owned forwarding header on Vercel', () => {
  const spoofed = new Request('http://localhost', { headers: {
    'x-forwarded-for': '198.51.100.9',
    'x-real-ip': '198.51.100.10',
    'x-vercel-forwarded-for': '203.0.113.1, 10.0.0.1',
  } });
  assert.equal(clientRateLimitKey(spoofed, true), '203.0.113.1');
  assert.equal(clientRateLimitKey(spoofed, false), 'shared-untrusted-proxy');
  assert.equal(clientRateLimitKey(new Request('http://localhost'), true), 'unknown-vercel-client');
});

test('rate limiter stays bounded and continues after eviction and expiry pruning', () => {
  let currentTime = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 100, maxEntries: 2, now: () => currentTime });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('b').allowed, true);
  assert.equal(limiter.check('c').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  currentTime = 101;
  assert.equal(limiter.check('d').allowed, true);
  assert.equal(limiter.check('d').allowed, false);
});
