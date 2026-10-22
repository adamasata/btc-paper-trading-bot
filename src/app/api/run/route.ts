import { NextResponse } from 'next/server';
import { runBacktest } from '@/domain/backtest';
import { fetchLatest24h } from '@/lib/market-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const market = await fetchLatest24h();
    const result = runBacktest(market.candles);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      source: market.source,
      dataWindow: { startTime: market.startTime, endTime: market.endTime },
      result,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return NextResponse.json({ error: message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
