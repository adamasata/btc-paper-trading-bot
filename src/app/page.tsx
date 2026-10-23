'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BacktestResult, CompletedTrade } from '@/domain/types';

type RunResponse = { generatedAt: string; source: string; dataWindow: { startTime: number; endTime: number }; result: BacktestResult };
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const btc = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const formatUtc = (value: number | Date) => `${dateTime.format(value)} UTC`;

function SignedMoney({ value }: { value: number }) {
  return <span className={value >= 0 ? 'value-positive' : 'value-negative'}>{value >= 0 ? '+' : ''}{usd.format(value)}</span>;
}

function TradeRow({ trade }: { trade: CompletedTrade }) {
  return <tr><td><span className="mono">#{trade.id}</span></td><td><span className="tag">{trade.kind.replace('-', ' ')}</span></td><td><strong>{formatUtc(trade.buyTime)}</strong><small>{usd.format(trade.buyPrice)}</small></td><td><strong>{formatUtc(trade.sellTime)}</strong><small>{usd.format(trade.sellPrice)}</small></td><td><strong>{usd.format(trade.quantityBtc * trade.buyPrice)}</strong><small>{btc.format(trade.quantityBtc)} BTC</small></td><td>{usd.format(trade.buyFeeUsd + trade.sellFeeUsd)}</td><td><span className="tag">{trade.exitReason.replace('-', ' ')}</span></td><td><SignedMoney value={trade.profitUsd} /><small>{trade.profitPercent >= 0 ? '+' : ''}{trade.profitPercent.toFixed(2)}%</small></td></tr>;
}

export default function Home() {
  const [run, setRun] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function runLatest24h() {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/run', { method: 'POST', cache: 'no-store' });
      const payload: RunResponse | { error: string } = await response.json();
      if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Replay request failed.');
      setRun(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to run the replay.'); }
    finally { setLoading(false); }
  }
  const result = run?.result;
  return <main>
    <nav className="site-nav" aria-label="Primary navigation">
      <Link className="brand" href="/" aria-label="BTCHunter home"><span className="brand-mark">₿</span><span>BTCHUNTER</span></Link>
      <span className="nav-context">BTC/USD paper research</span>
      <div className="nav-links"><Link href="/decision-lab">Decision Lab</Link><Link href="/decision-methodology">Methodology</Link></div>
      <button className="button button-primary" onClick={runLatest24h} disabled={loading}><span className={loading ? 'spinner' : 'button-dot'} />{loading ? 'Replaying…' : 'Run latest 24h'}</button>
    </nav>
    <section className="hero home-hero" aria-labelledby="home-title">
      <div><p className="eyebrow">Causal paper replay</p><h1 id="home-title">Clarity over<br /><em>confidence.</em></h1><p className="lede">A deterministic BTC/USD replay built from completed one-minute candles, next-candle-open fills, and disclosed fees.</p><div className="hero-links"><Link className="text-link" href="/decision-lab">Explore Decision Lab <span>→</span></Link><span>Read-only research, never live execution</span></div></div>
      <aside className="status-card"><span className="status-dot" /><div><p className="eyebrow">Replay engine</p><strong>{result ? 'Latest replay complete' : 'Ready for a fresh replay'}</strong><small>{run ? `Generated ${formatUtc(new Date(run.generatedAt))}` : 'Completed data only · no account connection'}</small></div></aside>
    </section>
    <section className="research-status" aria-label="Research status"><span className="status-dot" /><div><strong>No validated winner</strong><p>V1 is a transparent baseline for replay, not a profitable or recommended strategy.</p></div></section>
    {error && <section className="notice notice-error" role="alert"><div><strong>Replay unavailable</strong><span>{error}</span></div><button className="button button-secondary" onClick={runLatest24h}>Try again</button></section>}
    {!result && !error && <section className="empty-state"><span className="empty-symbol">₿</span><div><p className="eyebrow">No replay loaded</p><h2>One clean run. One accountable result.</h2><p>Run the latest completed 24-hour window to inspect the ledger, fees, and exit conditions. Nothing is simulated as a live fill.</p></div><button className="button button-primary" onClick={runLatest24h} disabled={loading}>{loading ? 'Replaying…' : 'Start replay'}</button></section>}
    {result && <>
      <section className="metric-grid" aria-label="Replay summary">
        <article className="metric-card metric-feature"><p>Final balance</p><h2>{usd.format(result.finalBalanceUsd)}</h2><SignedMoney value={result.profitUsd} /><small>{result.profitPercent >= 0 ? '+' : ''}{result.profitPercent.toFixed(2)}% net of fees</small></article>
        <article className="metric-card"><p>Completed rounds</p><h2>{result.trades.length}</h2><span>{result.coreTradeCount} core · {result.activityProbeTradeCount} probes</span><small>{result.trades.length >= 5 ? 'Numeric threshold met' : 'Below 5-trade threshold'}</small></article>
        <article className="metric-card"><p>Buy &amp; hold</p><h2>{usd.format(result.buyAndHoldFinalUsd)}</h2><SignedMoney value={result.buyAndHoldProfitUsd} /><small>same entry/exit fee model</small></article>
        <article className="metric-card"><p>Fees paid</p><h2>{usd.format(result.totalFeesUsd)}</h2><span>0.10% each side</span><small>included in every result</small></article>
      </section>
      <section className="content-grid"><article className="surface results-panel"><header className="section-header"><div><p className="eyebrow">Execution ledger</p><h2>Every completed round trip</h2></div><span className="status-chip status-neutral">Flat at end</span></header><div className="table-wrap"><table><thead><tr><th>Round</th><th>Strategy</th><th>Buy</th><th>Sell</th><th>Size</th><th>Fees</th><th>Exit</th><th>Net P/L</th></tr></thead><tbody>{result.trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}</tbody></table></div></article>
      <aside className="side-stack"><article className="surface detail-panel"><p className="eyebrow">Data window</p><h3>{run.source}</h3><dl><div><dt>From</dt><dd>{formatUtc(run.dataWindow.startTime)}</dd></div><div><dt>To</dt><dd>{formatUtc(run.dataWindow.endTime)}</dd></div><div><dt>Candles</dt><dd>{result.candleCount} × 1 minute</dd></div></dl></article><article className="surface detail-panel"><p className="eyebrow">Fixed strategy</p><h3>Trend core + transparent probes</h3><p>After 60 completed minutes, a core trade can fill next open when its fixed EMA conditions pass. Six disclosed activity probes use 0.1% available cash and hold exactly 10 minutes.</p><dl><div><dt>Core exit</dt><dd>±0.25%, cross, or 60m</dd></div><div><dt>Core limit</dt><dd>1 per window</dd></div><div><dt>Lookahead</dt><dd>None</dd></div></dl></article></aside></section>
      <section className="method-note"><p className="eyebrow">Method note</p><p>This is a paper backtest, not investment advice. Activity probes are disclosed mechanics, not hidden alpha. A forced final close exists solely to end the replay flat and is labeled in the ledger.</p></section>
    </>}
  </main>;
}
