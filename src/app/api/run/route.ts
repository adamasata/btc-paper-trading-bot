import { NextResponse } from 'next/server';
import { clientRateLimitKey, createRateLimiter } from '@/lib/rate-limit';
import { getLatestReplay } from '@/lib/replay-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const rateLimiter = createRateLimiter();

export async function POST(request: Request) {
  const rateLimit = rateLimiter.check(clientRateLimitKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many replay requests. Please try again shortly.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    return NextResponse.json(await getLatestReplay(), {
      headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
    });
  } catch (error) {
    console.error('BTC/USD replay failed.', error);
    return NextResponse.json(
      { error: 'Market-data replay is temporarily unavailable. Please try again shortly.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
