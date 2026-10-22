'use client';

import { useState } from 'react';
import type { BacktestResult, CompletedTrade } from '@/domain/types';

type RunResponse = {
  generatedAt: string;
  source: string;
  dataWindow: { startTime: number; endTime: number };
  result: BacktestResult;
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const btc = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function SignedMoney({ value }: { value: number }) {
  return <span className={value >= 0 ? 'positive' : 'negative'}>{value >= 0 ? '+' : ''}{usd.format(value)}</span>;
}

function TradeRow({ trade }: { trade: CompletedTrade }) {
  return (
    <tr>
      <td><span className="trade-id">#{trade.id}</span></td>
      <td><strong>{dateTime.format(trade.buyTime)}</strong><small>{usd.format(trade.buyPrice)}</small></td>
      <td><strong>{dateTime.format(trade.sellTime)}</strong><small>{usd.format(trade.sellPrice)}</small></td>
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
  const status = result ? (result.profitUsd > 0 && result.trades.length >= 5 ? 'Review-ready run' : 'Honest replay result') : 'Ready to replay';

  return (
    <main>
      <nav>
        <a className="brand" href="#top" aria-label="Lumen home"><span className="brand-mark">L</span> LUMEN</a>
        <span className="nav-note">Paper execution · BTC/USD</span>
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
          {run && <time>Generated {dateTime.format(new Date(run.generatedAt))}</time>}
        </aside>
      </section>

      {error && <section className="error-box" role="alert"><strong>Market-data replay unavailable.</strong><span>{error}</span><button onClick={runLatest24h}>Try again</button></section>}

      {!result && !error && <section className="empty-state"><div className="empty-orb">₿</div><h2>One clean run, one honest result.</h2><p>Press <strong>Run latest 24h</strong> to fetch a fresh completed rolling day from Binance.US, with Coinbase Exchange as a public fallback.</p></section>}

      {result && <>
        <section className="summary-grid" aria-label="Replay summary">
          <article><p>FINAL BALANCE</p><h2>{usd.format(result.finalBalanceUsd)}</h2><SignedMoney value={result.profitUsd} /><small>{result.profitPercent >= 0 ? '+' : ''}{result.profitPercent.toFixed(2)}% net</small></article>
          <article><p>COMPLETED ROUNDS</p><h2>{result.trades.length}</h2><span className={result.trades.length >= 5 ? 'positive' : 'negative'}>{result.trades.length >= 5 ? '5+ threshold met' : 'Below 5-trade threshold'}</span></article>
          <article><p>BUY & HOLD</p><h2>{usd.format(result.buyAndHoldFinalUsd)}</h2><SignedMoney value={result.buyAndHoldProfitUsd} /><small>same entry/exit fee model</small></article>
          <article><p>FEES PAID</p><h2>{usd.format(result.totalFeesUsd)}</h2><span>0.10% buy + 0.10% sell</span></article>
        </section>

        <section className="content-grid">
          <article className="panel results-panel">
            <header className="panel-header"><div><p className="eyebrow">Execution ledger</p><h2>Every completed round trip</h2></div><span className="pill">Flat at end</span></header>
            <div className="table-wrap"><table><thead><tr><th>ROUND</th><th>BUY</th><th>SELL</th><th>SIZE</th><th>FEES</th><th>EXIT</th><th>NET P/L</th></tr></thead><tbody>{result.trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}</tbody></table></div>
          </article>
          <aside className="side-stack">
            <article className="panel detail-panel"><p className="eyebrow">Data window</p><h3>{run.source}</h3><dl><div><dt>FROM</dt><dd>{dateTime.format(run.dataWindow.startTime)}</dd></div><div><dt>TO</dt><dd>{dateTime.format(run.dataWindow.endTime)}</dd></div><div><dt>CANDLES</dt><dd>{result.candleCount} × 1 minute</dd></div></dl></article>
            <article className="panel detail-panel"><p className="eyebrow">Fixed strategy</p><h3>Mean reversion + cadence</h3><p className="detail-copy">After a 30-minute history, buy a ≤−3.0 z-score dislocation and sell a fee-aware recovery, 0.32% target, 0.65% stop, or 10-minute limit. Six predeclared four-hour entry opportunities keep participation testable; they are not selected from results.</p><dl><div><dt>ENTRY</dt><dd>30m z-score ≤ −3.0</dd></div><div><dt>TAKE / STOP</dt><dd>+0.32% / −0.65%</dd></div><div><dt>MAX HOLD</dt><dd>10 minutes</dd></div><div><dt>FILL MODEL</dt><dd>Next candle open</dd></div><div><dt>LOOKAHEAD</dt><dd>None</dd></div></dl></article>
          </aside>
        </section>
        <section className="disclaimer"><span>Method note</span><p>This is a paper backtest, not investment advice. A causal strategy cannot legally or honestly guarantee a profit on every future 24-hour window. The forced final close exists only to end the replay flat; it is labeled in the ledger if used.</p></section>
      </>}
    </main>
  );
}
