'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DecisionPayload } from '@/lib/decision-service';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

function money(value: number | null): string {
  return value === null ? '—' : usd.format(value);
}

function formatUtc(value: number | null): string {
  return value === null ? '—' : `${dateTime.format(value)} UTC`;
}

function formatAge(value: number | null): string {
  if (value === null) return '—';
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export default function DecisionLab() {
  const [payload, setPayload] = useState<DecisionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/decision', { cache: 'no-store' });
      const body: DecisionPayload | { error: string } = await response.json();
      if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error : 'Decision Lab request failed.');
      setPayload(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the Decision Lab.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const decision = payload?.decision;
  return (
    <main className="decision-lab">
      <nav>
        <Link className="brand" href="/" aria-label="Lumen home"><span className="brand-mark">L</span> LUMEN</Link>
        <span className="nav-note">Read-only research · BTC/USD</span>
        <Link className="lab-home-link" href="/">Paper replay</Link>
        <Link className="methodology-link" href="/decision-methodology">Methodology &amp; sources</Link>
        <button className="run-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing research…' : 'Refresh decision'}</button>
      </nav>

      <section className="lab-hero">
        <div>
          <p className="eyebrow">Decision Lab · v1</p>
          <h1>Rules first.<br /><em>Conviction second.</em></h1>
          <p className="lede">A read-only BTC/USD research slice using completed public candles. It does not place, alter, or automate trades; the existing replay and bot behavior remain separate.</p>
        </div>
        <aside className="lab-disclosure"><strong>Research only</strong><span>Action-rule coverage is not probability, investment advice, or a live-trading signal.</span></aside>
      </section>

      {error && <section className="error-box" role="alert"><strong>Decision Lab unavailable.</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></section>}
      {loading && !decision && <section className="lab-loading">Loading required completed candle data. Required candle data that is missing or stale fails closed to NO TRADE; optional Fear &amp; Greed context is disclosed separately and cannot change the action.</section>}

      {decision && <>
        <section className={`decision-hero ${decision.action === 'ENTER LONG' ? 'decision-enter' : 'decision-no-trade'}`} aria-label="Current Decision">
          <div><p>Current Decision</p><h2>{decision.action}</h2><span>{decision.actionReason}</span></div>
          <div className="coverage"><p>Action-rule score</p><strong>{decision.evidenceScore.passed}/{decision.evidenceScore.total}</strong><span>{decision.evidenceScore.label}</span></div>
          <div className="decision-stamp"><p>Generated</p><strong>{formatUtc(new Date(payload.generatedAt).getTime())}</strong><span>{payload.source} public data</span></div>
        </section>

        <section className="lab-grid">
          <article className="lab-panel"><p className="eyebrow">Regime</p><h2>{decision.regime.bullish ? 'Bullish daily regime' : 'Regime not confirmed'}</h2><dl className="lab-metrics"><div><dt>COMPLETED DAILY CLOSE</dt><dd>{money(decision.regime.dailyClose)}</dd></div><div><dt>21-DAY SMA</dt><dd>{money(decision.regime.sma21)}</dd></div><div><dt>21-DAY EMA</dt><dd>{money(decision.regime.ema21)}</dd></div><div><dt>100-DAY SMA CONTEXT</dt><dd>{money(decision.regime.sma100)}</dd></div><div><dt>200-DAY SMA CONTEXT</dt><dd>{money(decision.regime.sma200)}</dd></div></dl><p className="lab-copy">{decision.regime.context}</p></article>

          <article className="lab-panel"><p className="eyebrow">Setup / proposed execution</p><h2>{decision.setup.pivotName ?? 'No eligible frozen pivot'}</h2><dl className="lab-metrics"><div><dt>FROZEN PIVOT</dt><dd>{money(decision.setup.pivot)}</dd></div><div><dt>14H ATR</dt><dd>{money(decision.setup.atr14)}</dd></div><div><dt>21H EMA CONTEXT</dt><dd>{money(decision.setup.ema21h)}</dd></div><div><dt>CONFIRMED RECLAIM</dt><dd>{decision.setup.confirmedReclaim ? 'Yes' : 'No'}</dd></div><div><dt>NO-CHASE FILTER</dt><dd>{decision.setup.noChase ? 'Pass' : 'Fail'}</dd></div><div><dt>ENTRY MODEL</dt><dd>{decision.setup.executionModel}</dd></div><div><dt>PROPOSED EXECUTION</dt><dd>{formatUtc(decision.setup.proposedExecutionAt)}</dd></div><div><dt>PROPOSED INVALIDATION</dt><dd>{money(decision.setup.proposedInvalidation)}</dd></div><div><dt>RISK / +1R / +2R</dt><dd>Calculate at actual fill</dd></div><div><dt>PROPOSAL EXPIRY</dt><dd>{formatUtc(decision.setup.expiry)}</dd></div></dl><p className="lab-copy">{decision.setup.executionInstruction}</p></article>

          <article className="lab-panel"><p className="eyebrow">Fear &amp; Greed context</p><h2>{decision.fearGreed.value === null ? 'Unavailable' : `${decision.fearGreed.value} · ${decision.fearGreed.classification}`}</h2><dl className="lab-metrics"><div><dt>SOURCE TIMESTAMP</dt><dd>{formatUtc(decision.fearGreed.sourceTimestamp)}</dd></div><div><dt>DATA AGE</dt><dd>{formatAge(decision.fearGreed.ageMs)}</dd></div><div><dt>7-DAY DIRECTION</dt><dd>{decision.fearGreed.direction7d}</dd></div><div><dt>CONTEXT HEALTH</dt><dd>{decision.contextHealth.available ? 'Available' : 'Unavailable'}</dd></div></dl><p className="context-badge">{decision.contextHealth.summary}</p><a className="source-link" href={decision.fearGreed.sourceUrl} target="_blank" rel="noreferrer">Alternative.me Fear &amp; Greed Index ↗</a></article>
        </section>

        <section className="lab-panel ledger-panel"><header><div><p className="eyebrow">Action evidence ledger</p><h2>Every actioning deterministic rule</h2></div><span className={decision.data.dataQualityPass ? 'quality-pass' : 'quality-fail'}>{decision.data.dataQualityPass ? 'Required candle data pass' : 'Fail closed'}</span></header><div className="ledger-table"><table><thead><tr><th>RULE</th><th>STATUS</th><th>EVIDENCE</th></tr></thead><tbody>{decision.actionRules.map((rule) => <tr key={rule.id}><td>{rule.label}</td><td><span className={rule.passed ? 'rule-pass' : 'rule-fail'}>{rule.passed ? 'Passed' : 'Failed'}</span></td><td>{rule.detail}</td></tr>)}</tbody></table></div></section>

        <section className="lab-panel ledger-panel context-ledger"><header><div><p className="eyebrow">Optional context health</p><h2>Fear &amp; Greed is not action evidence</h2></div><span className={decision.contextHealth.available ? 'quality-pass' : 'quality-fail'}>{decision.contextHealth.available ? 'Context available' : 'Context unavailable'}</span></header><div className="ledger-table"><table><thead><tr><th>CONTEXT CHECK</th><th>STATUS</th><th>EVIDENCE</th></tr></thead><tbody>{decision.contextHealth.rules.map((rule) => <tr key={rule.id}><td>{rule.label}</td><td><span className={rule.passed ? 'rule-pass' : 'rule-fail'}>{rule.passed ? 'Passed' : 'Unavailable'}</span></td><td>{rule.detail}</td></tr>)}</tbody></table></div></section>

        <section className="lab-notes"><div><p className="eyebrow">Methodology / Source Inspiration</p><h2>Frameworks, not copied calls.</h2></div><div><p>V1 independently operationalizes a 21-day moving-average regime, frozen high-timeframe close-mean pivots, and completed-candle confirmation. The 21-hour EMA and Fear &amp; Greed are context only. Creator references informed research questions, not discretionary trade calls.</p><p>It never automates creator price targets, harmonics, clickbait titles, or social sentiment. Content can contain commercial incentives, hindsight framing, selection bias, and incomplete risk disclosure. Read the deployed <Link href="/decision-methodology">methodology and auditable source registry</Link>; the repository registry remains in <code>docs/decision-methodology.md</code>.</p></div></section>
      </>}
    </main>
  );
}
