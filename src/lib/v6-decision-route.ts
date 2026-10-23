import { NextResponse } from 'next/server';
import { clientRateLimitKey, type RateLimiter } from '@/lib/rate-limit';
import type { V6DecisionPayload } from './v6-decision-service';

export type V6DecisionRouteDependencies = Readonly<{
  getDecision: () => Promise<V6DecisionPayload>;
  rateLimiter: RateLimiter;
  logError?: (message: string, error: unknown) => void;
}>;

/** Public, read-only endpoint for an explicitly unvalidated shadow model. */
export function createV6DecisionRoute(dependencies: V6DecisionRouteDependencies) {
  const logError = dependencies.logError ?? console.error;
  return async function GET(request: Request) {
    const rateLimit = dependencies.rateLimiter.check(clientRateLimitKey(request));
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many v6 shadow-decision requests. Please try again shortly.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }
    try {
      const payload = await dependencies.getDecision();
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      logError('v6 shadow-decision refresh failed.', error);
      return NextResponse.json(
        { error: 'v6 shadow decision is temporarily unavailable; the experimental paper model fails closed.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  };
}
