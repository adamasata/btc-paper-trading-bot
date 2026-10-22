import { NextResponse } from 'next/server';
import { clientRateLimitKey, type RateLimiter } from '@/lib/rate-limit';
import type { DecisionPayload } from '@/lib/decision-service';

export const DECISION_SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=60';

export type DecisionRouteDependencies = {
  getDecision: () => Promise<DecisionPayload>;
  rateLimiter: RateLimiter;
  logError?: (message: string, error: unknown) => void;
};

/**
 * The module-local limiter and single-flight cache reduce duplicate upstream
 * work in one runtime only. CDN caching is safe because this endpoint is
 * public, read-only research data; multi-instance protection still needs an
 * edge or shared-store limit.
 */
export function createDecisionRoute(dependencies: DecisionRouteDependencies) {
  const logError = dependencies.logError ?? console.error;

  return async function GET(request: Request) {
    const rateLimit = dependencies.rateLimiter.check(clientRateLimitKey(request));
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many Decision Lab requests. Please try again shortly.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    try {
      return NextResponse.json(await dependencies.getDecision(), {
        headers: { 'Cache-Control': DECISION_SUCCESS_CACHE_CONTROL },
      });
    } catch (error) {
      logError('Decision Lab refresh failed.', error);
      return NextResponse.json(
        { error: 'Decision Lab data is temporarily unavailable. The read-only decision fails closed.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  };
}
