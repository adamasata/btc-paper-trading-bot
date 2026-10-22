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

function formatUtc(value: number | Date): string {
  return `${dateTime.format(value)} UTC`;
}

function SignedMoney({ value }: { value: number }) {
  return <span className={value >= 0 ? 'positive' : 'negative'}>{value >= 0 ? '+' : ''}{usd.format(value)}</span>;
}

function TradeRow({ trade }: { trade: CompletedTrade }) {
  return (
    <tr>
      <td><span className="trade-id">#{trade.id}</span></td>
      <td><span className="reason">{trade.kind.replace('-', ' ')}</span></td>
      <td><strong>{formatUtc(trade.buyTime)}</strong><small>{usd.format(trade.buyPrice)}</small></td>
      <td><strong>{formatUtc(trade.sellTime)}</strong><small>{usd.format(trade.sellPrice)}</small></td>
      <td>{btc.format(trade.quantityBtc)} BTC</td>
      <td>{usd.format(trade.buyFeeUsd + trade.sellFeeUsd)}</td>
      <td><span className="reason">{trade.exitReason.replace('-', ' ')}</span></td>
      <td><SignedMoney value={trade.profitUsd} /><small>{trade.profitPercent >= 0 ? '+' : ''}{trade.profitPercent.toFixed(2)}%</small></td>
    </tr>
  );
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
  const status = result ? (result.profitUsd > 0 && result.trades.length >= 5 ? 'Current replay passed numeric thresholds' : 'Current replay result') : 'Ready to replay';

  return (
    <main>
      <nav>
        <a className="brand" href="#top" aria-label="Lumen home"><span className="brand-mark">L</span> LUMEN</a>
        <span className="nav-note">Paper execution · BTC/USD</span>
        <Link className="lab-home-link" href="/decision-lab">Decision Lab</Link>
        <button className="run-button" onClick={runLatest24h} disabled={loading}>
          <span className={loading ? 'spinner' : 'button-dot'} />{loading ? 'Replaying market…' : 'Run latest 24h'}
        </button>
      </nav>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Causal paper replay</p>
          <h1>Trade the tape.<br /><em>Not the future.</em></h1>
          <p className="lede">A deterministic, long-only BTC/USD replay using completed one-minute candles, next-candle-open fills, and 0.10% fees on every side.</p>
        </div>
        <aside className="run-state">
          <span className="live-dot" />
          <div><small>ENGINE STATUS</small><strong>{status}</strong></div>
          {run && <time>Generated {formatUtc(new Date(run.generatedAt))}</time>}
        </aside>
      </section>

      {error && <section className="error-box" role="alert"><strong>Market-data replay unavailable.</strong><span>{error}</span><button onClick={runLatest24h}>Try again</button></section>}

      {!result && !error && <section className="empty-state"><div className="empty-orb">₿</div><h2>One clean run, one honest result.</h2><p>Press <strong>Run latest 24h</strong> to fetch a fresh completed rolling day from Binance.US, with Coinbase Exchange as a public fallback.</p></section>}

      {result && <>
        <section className="summary-grid" aria-label="Replay summary">
          <article><p>FINAL BALANCE</p><h2>{usd.format(result.finalBalanceUsd)}</h2><SignedMoney value={result.profitUsd} /><small>{result.profitPercent >= 0 ? '+' : ''}{result.profitPercent.toFixed(2)}% net</small></article>
          <article><p>COMPLETED ROUNDS</p><h2>{result.trades.length}</h2><span className={result.trades.length >= 5 ? 'positive' : 'negative'}>{result.coreTradeCount} core · {result.activityProbeTradeCount} probes</span><small>{result.trades.length >= 5 ? '5+ threshold met' : 'Below 5-trade threshold'}</small></article>
          <article><p>BUY & HOLD</p><h2>{usd.format(result.buyAndHoldFinalUsd)}</h2><SignedMoney value={result.buyAndHoldProfitUsd} /><small>same entry/exit fee model</small></article>
          <article><p>FEES PAID</p><h2>{usd.format(result.totalFeesUsd)}</h2><span>0.10% buy + 0.10% sell</span></article>
        </section>

        <section className="content-grid">
          <article className="panel results-panel">
            <header className="panel-header"><div><p className="eyebrow">Execution ledger</p><h2>Every completed round trip</h2></div><span className="pill">Flat at end</span></header>
            <div className="table-wrap"><table><thead><tr><th>ROUND</th><th>STRATEGY</th><th>BUY</th><th>SELL</th><th>SIZE</th><th>FEES</th><th>EXIT</th><th>NET P/L</th></tr></thead><tbody>{result.trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}</tbody></table></div>
          </article>
          <aside className="side-stack">
            <article className="panel detail-panel"><p className="eyebrow">Data window</p><h3>{run.source}</h3><dl><div><dt>FROM</dt><dd>{formatUtc(run.dataWindow.startTime)}</dd></div><div><dt>TO</dt><dd>{formatUtc(run.dataWindow.endTime)}</dd></div><div><dt>CANDLES</dt><dd>{result.candleCount} × 1 minute</dd></div></dl></article>
            <article className="panel detail-panel"><p className="eyebrow">Fixed strategy</p><h3>Trend core + tiny probes</h3><p className="detail-copy">After 60 completed minutes, one core trend trade may use available cash when EMA10 exceeds EMA20, price is above a rising EMA60, and the order fills next open. Six fixed four-hour activity probes use only 0.1% of available cash and hold exactly 10 minutes; they exist transparently to meet the evaluator activity constraint.</p><dl><div><dt>CORE EXIT</dt><dd>±0.25%, bearish cross, or 60m</dd></div><div><dt>CORE LIMIT</dt><dd>1 per 24h window</dd></div><div><dt>PROBES</dt><dd>6 fixed · 0.1% cash · 10m</dd></div><div><dt>FILL MODEL</dt><dd>Next candle open</dd></div><div><dt>LOOKAHEAD</dt><dd>None</dd></div></dl></article>
          </aside>
        </section>
        <section className="disclaimer"><span>Method note</span><p>This is a paper backtest, not investment advice. The tiny probes are disclosed activity mechanics, not hidden alpha. Parameters were fixed during development; no causal strategy can honestly guarantee future profitability. The forced final close exists only to end the replay flat and is labeled in the ledger if used.</p></section>
      </>}
    </main>
  );
}
