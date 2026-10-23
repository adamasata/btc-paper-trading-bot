'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DecisionPayload } from '@/lib/decision-service';
import type { V6DecisionPayload } from '@/lib/v6-decision-service';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const money = (value: number | null) => value === null ? '—' : usd.format(value);
const formatUtc = (value: number | null) => value === null ? '—' : `${dateTime.format(value)} UTC`;
const formatBtc = (value: number | null) => value === null ? '—' : `${value.toFixed(8)} BTC`;
const ratio = (value: number | null) => value === null ? '—' : value.toFixed(3);

function v6StateClass(state: V6DecisionPayload['candidates'][number]['state']): string {
  if (state === 'data_invalid' || state === 'insufficient_history') return 'status-rejected';
  if (state === 'entry_ready' || state === 'long') return 'status-current';
  return 'status-neutral';
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

async function readPayload<T extends object>(url: string, timeoutMs?: number): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs) });
  const body: T | { error: string } = await response.json();
  if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error : `${url} request failed.`);
  return body;
}

export default function DecisionLab() {
  const [payload, setPayload] = useState<DecisionPayload | null>(null);
  const [v6Payload, setV6Payload] = useState<V6DecisionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v6Error, setV6Error] = useState<string | null>(null);
  const [loadingV1, setLoadingV1] = useState(true);
  const [loadingV6, setLoadingV6] = useState(true);
  async function refreshV1() {
    setLoadingV1(true); setError(null);
    try { setPayload(await readPayload<DecisionPayload>('/api/decision')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the Decision Lab.'); }
    finally { setLoadingV1(false); }
  }
  async function refreshV6() {
    setLoadingV6(true); setV6Error(null);
    try { setV6Payload(await readPayload<V6DecisionPayload>('/api/v6-decision', 15_000)); }
    catch (reason) { setV6Error(reason instanceof Error ? reason.message : 'Unable to load v6 shadow observation.'); }
    finally { setLoadingV6(false); }
  }
  useEffect(() => { void refreshV1(); void refreshV6(); }, []);
  const decision = payload?.decision;
  const statusClass = decision?.setup.executionStatus === 'CURRENT' ? 'status-current' : decision?.setup.executionStatus === 'EXPIRED' ? 'status-expired' : 'status-rejected';
  return <main className="decision-lab">
    <nav className="site-nav" aria-label="Primary navigation"><Link className="brand" href="/" aria-label="BTCHunter home"><span className="brand-mark">₿</span><span>BTCHUNTER</span></Link><span className="nav-context">BTC/USD research</span><div className="nav-links"><Link href="/">Replay</Link><Link href="/decision-methodology">Methodology</Link></div><button className="button button-primary" onClick={() => void refreshV1()} disabled={loadingV1}>{loadingV1 ? 'Refreshing v1…' : 'Refresh v1'}</button></nav>
    <section className="hero lab-hero" aria-labelledby="lab-title"><div><p className="eyebrow">Decision Lab · v1 + v6 shadow</p><h1 id="lab-title">Evidence before<br /><em>execution.</em></h1><p className="lede">A read-only BTC/USD research slice using completed public candles.</p></div><aside className="status-card"><span className="status-dot" /><div><p className="eyebrow">Research boundary</p><strong>Deterministic rules</strong><small>Completed candles · explicit timing · visible rule coverage</small></div></aside></section>
    <section className="research-status" aria-label="Research status"><span className="status-dot" /><div><strong>v1 and v6 rule sets</strong><p>Decision Lab shows the current deterministic research state.</p></div></section>
    {error && <section className="notice notice-error" role="alert"><div><strong>Decision Lab unavailable</strong><span>{error}</span></div><button className="button button-secondary" onClick={() => void refreshV1()}>Try v1 again</button></section>}
    {loadingV1 && !decision && <section className="loading-state" aria-live="polite"><span className="spinner spinner-dark" /> <div><strong>Loading completed public candle data</strong><p>Missing or stale required candles fail closed to NO TRADE.</p></div></section>}
    {decision && <>
      <section className={`decision-banner ${decision.action === 'ENTER LONG' ? 'decision-enter' : 'decision-no-trade'}`} aria-label="Current research result"><div><p className="eyebrow">Current rule result</p><h2>{decision.action}</h2><p>{decision.actionReason}</p></div><div><p className="eyebrow">Execution status</p><span className={`status-chip ${statusClass}`}>{decision.setup.executionStatus}</span><small>{decision.setup.executionStatus === 'CURRENT' ? 'Observed at this exact UTC hour boundary' : 'No current actioning execution'}</small></div><div><p className="eyebrow">Rule coverage</p><strong>{decision.evidenceScore.passed}/{decision.evidenceScore.total}</strong><small>{decision.evidenceScore.label}</small></div><div><p className="eyebrow">Generated</p><strong className="timestamp">{formatUtc(new Date(payload.generatedAt).getTime())}</strong><small>{payload.source} public data</small></div></section>
      <section className="lab-grid"><article className="surface lab-panel"><p className="eyebrow">Daily regime</p><h2>{decision.regime.bullish ? 'Bullish regime' : 'Regime not confirmed'}</h2><dl className="metric-list"><Metric label="Completed daily close" value={money(decision.regime.dailyClose)} /><Metric label="21-day SMA" value={money(decision.regime.sma21)} /><Metric label="21-day EMA" value={money(decision.regime.ema21)} /><Metric label="100-day context" value={money(decision.regime.sma100)} /><Metric label="200-day context" value={money(decision.regime.sma200)} /></dl><p className="lab-copy">{decision.regime.context}</p></article>
      <article className="surface lab-panel"><p className="eyebrow">Setup / execution</p><h2>{decision.setup.pivotName ?? 'No eligible pivot'}</h2><dl className="metric-list"><Metric label="Frozen pivot" value={money(decision.setup.pivot)} /><Metric label="14h ATR" value={money(decision.setup.atr14)} /><Metric label="21h EMA context" value={money(decision.setup.ema21h)} /><Metric label="Confirmed reclaim" value={decision.setup.confirmedReclaim ? 'Yes' : 'No'} /><Metric label="No-chase filter" value={decision.setup.noChase ? 'Pass' : 'Fail'} /><Metric label="Observed execution open" value={money(decision.setup.observedExecutionOpen)} /><Metric label="Execution instant" value={formatUtc(decision.setup.executionAt)} /><Metric label="Expiry" value={formatUtc(decision.setup.expiry)} /></dl><p className="lab-copy">{decision.setup.executionInstruction}</p></article></section>
      <section className="surface ledger-panel"><header className="section-header"><div><p className="eyebrow">Action evidence ledger</p><h2>Every deterministic action rule</h2></div><span className={`status-chip ${decision.data.dataQualityPass ? 'status-current' : 'status-rejected'}`}>{decision.data.dataQualityPass ? 'Candle data pass' : 'Fail closed'}</span></header><div className="table-wrap"><table><thead><tr><th>Rule</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{decision.actionRules.map((rule) => <tr key={rule.id}><td>{rule.label}</td><td><span className={`status-chip ${rule.passed ? 'status-current' : 'status-rejected'}`}>{rule.passed ? 'Passed' : 'Failed'}</span></td><td>{rule.detail}</td></tr>)}</tbody></table></div></section>
      <section className="method-note"><p className="eyebrow">Methodology</p><p>V1 operationalizes moving-average regime, frozen close-mean pivots, and completed-candle confirmation. The 21-hour EMA is displayed context only. See the <Link href="/decision-methodology">auditable methodology and source registry</Link>.</p></section>
    </>}
    {loadingV6 && !v6Payload && <section className="loading-state" aria-live="polite"><span className="spinner spinner-dark" /> <div><strong>Loading v6 shadow observation</strong><p>This independent request cannot delay v1.</p></div></section>}
    {v6Error && <section className="notice notice-error" role="alert"><div><strong>v6 shadow observation unavailable</strong><span>{v6Error}</span></div><button className="button button-secondary" onClick={() => void refreshV6()}>Try v6 again</button></section>}
    {v6Payload && <section className="surface ledger-panel" aria-label="v6 experimental shadow observation"><header className="section-header"><div><p className="eyebrow">Frozen v6 Stage-1 family</p><h2>Shadow observation</h2><p className="lab-copy">Three fixed anchored-VWAP and relative-volume variants, separate from the production replay.</p></div><div><span className={`status-chip ${v6Payload.data.dataQualityPass ? 'status-neutral' : 'status-rejected'}`}>{v6Payload.data.dataQualityPass ? 'DATA PASS' : 'DATA INVALID'}</span><button className="button button-secondary" onClick={() => void refreshV6()} disabled={loadingV6}>{loadingV6 ? 'Refreshing v6…' : 'Refresh v6'}</button></div></header><p className="lab-copy"><strong>Each entry targets 25% of that candidate’s account equity immediately before its fill.</strong> It is approximately $2,500 only at the initial $10,000 balance; displayed USD and BTC values below come from the candidate’s replayed cash, fills, and holdings.</p><div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Shadow state</th><th>Anchor / assessment UTC</th><th>Close vs AVWAP</th><th>Q</th><th>Next-minute open</th><th>Account / allocation</th></tr></thead><tbody>{v6Payload.candidates.map((item) => <tr key={item.candidateId}><td>{item.candidateId}</td><td><span className={`status-chip ${v6StateClass(item.state)}`}>{item.state}</span><br /><small>{item.reason}</small></td><td>{formatUtc(item.anchorTime)}<br />{formatUtc(item.assessmentTime)}</td><td>{money(item.price)} / {money(item.avwap)}</td><td>{ratio(item.participationQ)}</td><td>{formatUtc(item.execution.openTime)}<br />{item.execution.executable ? money(item.execution.observedOpen) : 'No observable execution open'}</td><td><strong>Equity {money(item.paperAccount.currentEquityUsd)}</strong><br />Cash {money(item.paperAccount.cashUsd)} · {formatBtc(item.paperAccount.btcQuantity)}<br />{item.paperAccount.intendedAllocationUsd === null ? 'No entry allocation' : `Target ${money(item.paperAccount.intendedAllocationUsd)}${item.paperAccount.preBuyEquityUsd === null ? '' : ` of pre-buy equity ${money(item.paperAccount.preBuyEquityUsd)}`}`}</td></tr>)}</tbody></table></div></section>}
  </main>;
}
