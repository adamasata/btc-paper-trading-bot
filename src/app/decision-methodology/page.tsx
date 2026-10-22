import Link from 'next/link';
import { methodologySources } from '@/lib/decision-methodology';

export const metadata = {
  title: 'Decision Lab Methodology | Lumen',
  description: 'Auditable Decision Lab v1 methodology, data contract, and source registry.',
};

function dateLabel(value: string | null): string {
  return value ?? 'Unknown / not independently retrieved';
}

export default function DecisionMethodologyPage() {
  return (
    <main className="methodology-page">
      <nav>
        <Link className="brand" href="/" aria-label="Lumen home"><span className="brand-mark">L</span> LUMEN</Link>
        <span className="nav-note">Decision Lab methodology · v1</span>
        <Link className="lab-home-link" href="/decision-lab">Decision Lab</Link>
      </nav>

      <section className="lab-hero methodology-hero">
        <div>
          <p className="eyebrow">Auditable methodology</p>
          <h1>Rules, sources,<br /><em>and limits.</em></h1>
          <p className="lede">This deployed record is sufficient to audit the read-only Decision Lab without repository access. It documents the actioning rules, context-only boundaries, execution timing, and registered research source mapping.</p>
        </div>
        <aside className="lab-disclosure"><strong>Not strategy proof</strong><span>Rule coverage is not probability, investment advice, or a claim of future performance.</span></aside>
      </section>

      <section className="methodology-grid">
        <article className="lab-panel"><p className="eyebrow">Scope / data contract</p><h2>Completed public data only</h2><ul><li>Requires at least 220 contiguous completed UTC daily BTC/USD candles and 22 contiguous completed UTC hourly candles from Binance.US.</li><li>Forming candles, malformed OHLC, gaps, and stale required candles fail the actioning data gate to <strong>NO TRADE</strong>.</li><li>Public API data is read-only. Decision Lab does not place orders, change the paper replay, or access credentials or account data.</li><li>Success responses may be publicly CDN-cached for 60 seconds with stale-while-revalidate. The module-local limiter and single-flight are best-effort per runtime, not production-wide controls.</li></ul></article>
        <article className="lab-panel"><p className="eyebrow">Actioning sequence</p><h2>Deterministic and fail closed</h2><ol><li>Latest completed daily close must be above completed 21-day SMA and EMA.</li><li>Use the nearest eligible frozen prior 7-day or 30-day close mean.</li><li>Require a strict completed-hour reclaim and a confirming close no more than 0.5 ATR above the pivot; 14-hour ATR must be at most 5% of the confirming close.</li><li>A passing setup is a proposed <strong>next hour open</strong> instruction. The confirming close is never a fill.</li></ol></article>
        <article className="lab-panel"><p className="eyebrow">Execution / risk boundary</p><h2>Do not invent a fill</h2><p className="lab-copy">At the next observed hourly open, execution is allowed only if the open is still above the pivot and within 0.5 ATR. Only that actual execution price can calculate risk and +1R/+2R targets. The Lab therefore shows a proposed invalidation threshold but no entry, risk, or targets before a causal next-open fill is known.</p><p className="lab-copy">The 21-hour EMA is displayed as hourly context only; it is not an undisclosed action rule.</p></article>
        <article className="lab-panel"><p className="eyebrow">Fear &amp; Greed boundary</p><h2>Context, not evidence score</h2><p className="lab-copy">Alternative.me Fear &amp; Greed is separate context health. Its refresh never delays validated required candle data, so an initial response may show context unavailable while a module-local refresh completes. It must be fresh and have seven records with roughly daily cadence (18–30 hours apart, 5–7 day span) before the Lab labels a seven-day direction. Missing, stale, or irregular data is disclosed as unavailable but cannot change action, pivot, risk, expiry, or action-rule coverage.</p></article>
      </section>

      <section className="lab-panel source-registry"><header><div><p className="eyebrow">Source registry</p><h2>Evidence mapped to implementation</h2></div><span className="context-badge">Direct links and retrieval caveats</span></header><div className="source-list">{methodologySources.map((source) => <article key={source.id} className="source-entry"><p className="eyebrow">[{source.id}] source record</p><h3><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></h3><dl><div><dt>CREATOR</dt><dd>{source.creator}</dd></div><div><dt>PUBLICATION DATE</dt><dd>{dateLabel(source.publicationDate)}</dd></div><div><dt>DIRECT URL</dt><dd><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></dd></div></dl><p><strong>Evidence / claim:</strong> {source.evidence}</p><p><strong>Decision Lab mapping:</strong> {source.decisionLabMapping}</p><p><strong>Retrieved / unknown caveat:</strong> {source.caveat}</p></article>)}</div></section>

      <section className="lab-notes"><div><p className="eyebrow">Research limits</p><h2>Frameworks, not copied calls.</h2></div><div><p>Creator videos and social posts can carry commercial, attention, hindsight, selection, survivorship, and incomplete-risk biases. A cited idea is not evidence of positive expectancy. Promotional or certainty framing is deliberately excluded from Decision Lab rules.</p><p>Decision Lab independently specifies its deterministic implementation. Before any context input can become actioning, it requires a separately pre-registered and documented out-of-sample walk-forward evaluation.</p></div></section>
    </main>
  );
}
