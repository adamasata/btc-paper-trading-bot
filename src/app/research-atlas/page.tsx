import Link from 'next/link';
import { summarizeResearchAtlas, type ResearchExperiment } from '@/lib/research-atlas';

export const metadata = {
  title: 'Research Atlas | BTCHunter',
  description: 'An auditable overview of BTCHunter research experiments, evidence, and promotion status.',
};

const atlas = summarizeResearchAtlas();

function EvaluationBadge({ experiment }: { experiment: ResearchExperiment }) {
  const label = experiment.evaluationState === 'pending' ? 'Evaluation pending' : 'Rejected — not authorized';
  const className = experiment.evaluationState === 'pending' ? 'status-neutral' : 'status-rejected';
  return <span className={`status-chip ${className}`}>{label}</span>;
}

function ScoreGrid({ score }: { score: NonNullable<ResearchExperiment['keyScore']> }) {
  return <dl className="atlas-score-grid">
    <div><dt>Positive windows</dt><dd>{score.positiveWindows}</dd></div>
    <div><dt>Mean return</dt><dd>{score.meanReturn}</dd></div>
    <div><dt>Profit factor</dt><dd>{score.profitFactor}</dd></div>
    <div><dt>Recorded total</dt><dd>{score.totalProfit}</dd></div>
  </dl>;
}

export default function ResearchAtlasPage() {
  const { bestObserved, productionWinner, experiments } = atlas;

  return <main className="research-atlas-page">
    <nav className="site-nav" aria-label="Primary navigation">
      <Link className="brand" href="/" aria-label="BTCHunter home"><span className="brand-mark">₿</span><span>BTCHUNTER</span></Link>
      <span className="nav-context">BTC/USD research record</span>
      <div className="nav-links"><Link href="/">Replay</Link><Link href="/decision-lab">Decision Lab</Link><Link href="/decision-methodology">Methodology</Link></div>
    </nav>

    <section className="hero atlas-hero" aria-labelledby="atlas-title">
      <div>
        <p className="eyebrow">Research Atlas · committed evidence only</p>
        <h1 id="atlas-title">What we tried.<br /><em>What survived.</em></h1>
        <p className="lede">A plain-language map of the registered BTC/USD research sequence: the methods, the observed results, and the discipline that prevented a losing result from becoming a winner.</p>
      </div>
      <aside className="status-card atlas-status-card">
        <span className="status-dot atlas-status-dot" />
        <div><p className="eyebrow">Program verdict</p><strong>{productionWinner === null ? 'No production winner' : 'Production winner authorized'}</strong><small>No experiment is authorized for production. Results below are research evidence, not trading advice.</small></div>
      </aside>
    </section>

    <section className="atlas-verdict" aria-labelledby="verdict-title">
      <div><p className="eyebrow">Top verdict</p><h2 id="verdict-title">No experiment earned promotion.</h2><p>Every evaluated path was rejected or remains unscored. A score that is less negative than another score is not a pass.</p></div>
      <p><strong>Promotion remains blocked:</strong> robust holdout evidence and unchanged forward paper performance are still required.</p>
    </section>

    <section className="atlas-feature" aria-labelledby="closest-title">
      <div className="atlas-feature-kicker"><span className="status-chip status-expired">Best observed (still rejected)</span><span>v5 · post-hoc exploratory</span></div>
      <div className="atlas-feature-copy"><p className="eyebrow">Closest / least-bad recorded result</p><h2 id="closest-title">{bestObserved.name}</h2><p>{bestObserved.method}</p><p className="atlas-feature-warning">It is highlighted only because it ranked closest among recorded rejected Atlas results. It is a rejected candidate, not a successful strategy.</p></div>
      {bestObserved.keyScore && <ScoreGrid score={bestObserved.keyScore} />}
      <div className="atlas-feature-footer"><strong>Why it stopped:</strong> {bestObserved.failureOrLearning} <span>{bestObserved.holdout}</span></div>
    </section>

    <section className="atlas-section" aria-labelledby="flight-path-title">
      <header className="atlas-section-header"><div><p className="eyebrow">Evidence flight path</p><h2 id="flight-path-title">Six steps. One honest conclusion.</h2></div><p>Each stop is a recorded methodology, not a claim of progress.</p></header>
      <ol className="atlas-flight-path" aria-label="Research experiment sequence">
        {experiments.map((experiment, index) => <li key={experiment.id} className={`atlas-flight-stop ${experiment.bestObserved ? 'atlas-flight-stop-best' : ''}`}>
          <span className="atlas-flight-number">{String(index + 1).padStart(2, '0')}</span>
          <span className={`atlas-flight-marker ${experiment.evaluationState === 'pending' ? 'atlas-flight-marker-pending' : ''}`} aria-hidden="true" />
          <div><strong>{experiment.id.toUpperCase()}</strong><span>{experiment.evaluationState === 'pending' ? 'Pending' : 'Rejected'}</span></div>
        </li>)}
      </ol>
    </section>

    <section className="atlas-layout" aria-label="Experiment registry and evaluation methodology">
      <div className="atlas-experiment-list">
        {experiments.map((experiment) => <article key={experiment.id} className={`surface atlas-experiment ${experiment.bestObserved ? 'atlas-experiment-best' : ''}`}>
          <header><div><p className="eyebrow">{experiment.id.toUpperCase()} · {experiment.treatment}</p><h2>{experiment.name}</h2></div><div className="atlas-card-status">{experiment.bestObserved && <span className="status-chip status-expired">Best observed (still rejected)</span>}<EvaluationBadge experiment={experiment} /></div></header>
          <div className="atlas-experiment-body">
            <div className="atlas-detail"><h3>Method</h3><p>{experiment.method}</p></div>
            <div className="atlas-detail"><h3>Failure / learning</h3><p>{experiment.failureOrLearning}</p></div>
            <div className="atlas-detail"><h3>Holdout treatment</h3><p>{experiment.holdout}</p></div>
            {experiment.keyScore ? <ScoreGrid score={experiment.keyScore} /> : <div className="atlas-unscored"><strong>{experiment.evaluationState === 'pending' ? 'No score reported yet' : 'No comparable headline score'}</strong><span>{experiment.evaluationState === 'pending' ? 'The frozen observer has not produced an evaluation result.' : 'The committed record rejects this methodology without a single headline score suitable for comparison.'}</span></div>}
          </div>
          <footer><span>Evidence source</span><code>{experiment.source}</code></footer>
        </article>)}
      </div>

      <aside className="atlas-rail" aria-labelledby="evaluation-rail-title">
        <section className="surface atlas-rail-panel"><p className="eyebrow">Evaluation rail</p><h2 id="evaluation-rail-title">How a candidate earns more scrutiny</h2><ol><li><strong>Data integrity first.</strong> Use completed, contiguous candles and reject gaps or malformed inputs.</li><li><strong>Develop chronologically.</strong> Evaluate on earlier windows before touching a later test.</li><li><strong>Keep the holdout sealed.</strong> Open it only after a candidate passes every development gate.</li><li><strong>Separate signals from mechanics.</strong> Fees and qualification mechanics are counted and disclosed; neither can manufacture genuine alpha.</li><li><strong>Promote last.</strong> Require robust holdout and unchanged forward paper performance before production authorization.</li></ol><Link className="text-link" href="/decision-methodology">Read the Decision Lab methodology →</Link></section>
        <section className="surface atlas-rail-panel atlas-terms"><p className="eyebrow">Plain-language terms</p><dl><div><dt>Positive window</dt><dd>A tested time slice that ended above its starting value after the stated costs.</dd></div><div><dt>Mean return</dt><dd>The average return across tested windows. Negative means losses outweighed gains on average.</dd></div><div><dt>Profit factor</dt><dd>Gross gains divided by gross losses. Above 1 is necessary, not sufficient.</dd></div><div><dt>Holdout</dt><dd>A final untouched period used only after a candidate qualifies.</dd></div></dl></section>
        <section className="atlas-caveat" aria-label="Evidence caveat"><strong>Confidence treatment</strong><p>v4 and v5 are post-hoc exploratory and carry cumulative multiple-testing risk across v1–v5. v1 is an exact-feed observational audit. v6 has no result yet.</p></section>
      </aside>
    </section>
  </main>;
}
