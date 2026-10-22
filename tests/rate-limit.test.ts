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

test('rate-limit keys use the first forwarded address and safely fall back', () => {
  assert.equal(clientRateLimitKey(new Request('http://localhost', { headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' } })), '203.0.113.1');
  assert.equal(clientRateLimitKey(new Request('http://localhost', { headers: { 'x-real-ip': '203.0.113.2' } })), '203.0.113.2');
  assert.equal(clientRateLimitKey(new Request('http://localhost')), 'unknown');
});
