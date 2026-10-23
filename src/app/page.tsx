'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BacktestResult, CompletedTrade } from '@/domain/types';

type RunResponse = {
  generatedAt: string;
  source: string;
  dataWindow: { startTime: number; endTime: number };
  result: BacktestResult;
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const btc = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const formatUtc = (value: number | Date) => `${dateTime.format(value)} UTC`;

function SignedMoney({ value }: { value: number }) {
  return <span className={value >= 0 ? 'value-positive' : 'value-negative'}>{value >= 0 ? '+' : ''}{usd.format(value)}</span>;
}

function TradeRow({ trade }: { trade: CompletedTrade }) {
  return <tr>
    <td><span className="mono">#{trade.id}</span></td>
    <td><strong>{formatUtc(trade.buyTime)}</strong><small>{usd.format(trade.buyPrice)}</small></td>
    <td><strong>{formatUtc(trade.sellTime)}</strong><small>{usd.format(trade.sellPrice)}</small></td>
    <td><strong>{usd.format(trade.quantityBtc * trade.buyPrice)}</strong><small>{btc.format(trade.quantityBtc)} BTC</small></td>
    <td>{usd.format(trade.buyFeeUsd + trade.sellFeeUsd)}</td>
    <td><span className="tag">{trade.exitReason.replace('-', ' ')}</span></td>
    <td><SignedMoney value={trade.profitUsd} /><small>{trade.profitPercent >= 0 ? '+' : ''}{trade.profitPercent.toFixed(2)}%</small></td>
  </tr>;
}

export default function Home() {
  const [run, setRun] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runLatest24h() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/run', { method: 'POST', cache: 'no-store' });
      const payload: RunResponse | { error: string } = await response.json();
      if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Replay request failed.');
      setRun(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to run the replay.');
    } finally {
      setLoading(false);
    }
  }

  const result = run?.result;

  return <main>
    <nav className="site-nav" aria-label="BTCHunter">
      <Link className="brand" href="/" aria-label="BTCHunter home"><span className="brand-mark">₿</span><span>BTCHUNTER</span></Link>
      <span className="nav-context">BTC/USD paper replay</span>
      <button className="button button-primary" onClick={runLatest24h} disabled={loading}>
        <span className={loading ? 'spinner' : 'button-dot'} />
        {loading ? 'Replaying…' : 'Run latest 24h'}
      </button>
    </nav>

    <section className="hero home-hero" aria-labelledby="home-title">
      <div>
        <p className="eyebrow">24-hour BTC/USD replay</p>
        <h1 id="home-title">One strategy.<br /><em>Full ledger.</em></h1>
        <p className="lede">BTCHunter replays completed one-minute candles with next-open fills and fees included in every result.</p>
      </div>
      <aside className="status-card" aria-label="Strategy status">
        <span className="status-dot" />
        <div>
          <p className="eyebrow">Strategy status</p>
          <strong>Experimental, not validated</strong>
          <small>{run ? `Replay generated ${formatUtc(new Date(run.generatedAt))}` : 'Paper-only · completed data · no account connection'}</small>
        </div>
      </aside>
    </section>

    {error && <section className="notice notice-error" role="alert">
      <div><strong>Replay unavailable</strong><span>{error}</span></div>
      <button className="button button-secondary" onClick={runLatest24h}>Try again</button>
    </section>}

    {!result && !error && <section className="empty-state">
      <span className="empty-symbol">₿</span>
      <div><p className="eyebrow">Ready</p><h2>Run the latest completed window.</h2><p>Inspect the balance, required rounds, fees, and every completed transaction.</p></div>
      <button className="button button-primary" onClick={runLatest24h} disabled={loading}>{loading ? 'Replaying…' : 'Run latest 24h'}</button>
    </section>}

    {result && <>
      <section className="metric-grid" aria-label="Replay summary">
        <article className="metric-card metric-feature"><p>Final balance</p><h2>{usd.format(result.finalBalanceUsd)}</h2><SignedMoney value={result.profitUsd} /><small>{result.profitPercent >= 0 ? '+' : ''}{result.profitPercent.toFixed(2)}% net P&amp;L</small></article>
        <article className="metric-card"><p>Completed rounds</p><h2>{result.trades.length}</h2><span>{result.trades.length >= 5 ? 'Requirement met' : 'Requirement not met'}</span><small>Minimum: 5 round trips</small></article>
        <article className="metric-card"><p>Fees paid</p><h2>{usd.format(result.totalFeesUsd)}</h2><span>0.10% on buy and sell</span><small>Included in net P&amp;L</small></article>
      </section>
      <p className="benchmark-line"><strong>Required benchmark — buy-and-hold:</strong> {usd.format(result.buyAndHoldFinalUsd)} final balance · <SignedMoney value={result.buyAndHoldProfitUsd} /> net P&amp;L on the same window and fee model.</p>

      <article className="surface results-panel">
        <header className="section-header"><div><p className="eyebrow">Transaction ledger</p><h2>Every completed round trip</h2></div><span className="status-chip status-neutral">Flat at end</span></header>
        <div className="table-wrap"><table><thead><tr><th>Round</th><th>Buy</th><th>Sell</th><th>Size</th><th>Fees</th><th>Exit</th><th>Net P/L</th></tr></thead><tbody>{result.trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}</tbody></table></div>
      </article>
      <section className="method-note"><p><strong>Rules &amp; data:</strong> {run.source}, {formatUtc(run.dataWindow.startTime)}–{formatUtc(run.dataWindow.endTime)} ({result.candleCount} one-minute candles). Fixed EMA conditions and scheduled qualification rounds fill at the next open; no lookahead, no leverage, and forced flat at end. Experimental, not validated.</p></section>
    </>}
  </main>;
}
