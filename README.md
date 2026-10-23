# BTCHunter — BTC/USD paper-trading research demo

BTCHunter is a runnable BTC/USD paper-trading and strategy-research demo prepared for Lumen. Its core replay answers a concrete question: how would a causal long-only strategy have traded the latest completed 24 hours using $10,000 of paper money, 0.10% fees on every buy and sell, and no knowledge of future candles?

It also provides a Decision Lab for developing better models without presenting an attractive chart pattern or one profitable replay as established trading edge.

## What the product does

- Fetches real public BTC/USD candles without API keys.
- Replays the latest 1,440 completed one-minute candles.
- Makes decisions only after candles close and fills eligible orders at the next candle's open.
- Runs long-only, without leverage or short selling.
- Charges exactly 0.10% on each buy and each sell.
- Closes every replay position before the 24-hour boundary.
- Shows every transaction with timestamps, prices, fees, USD notional, BTC quantity, and profit or loss.
- Reports final balance, USD and percentage return, trade count, and buy-and-hold over the same window.

## Technical-analysis philosophy

The demo treats technical analysis as a source of testable hypotheses—not certainty.

The research process can examine trend, market structure, volatility, relative volume, anchored VWAP, support and resistance, breakouts, and formally defined price patterns. Labels such as Bat, Shark, breakout, or liquidity sweep are never accepted from chart appearance alone. A usable feature must:

- have an objective and reproducible definition;
- use completed candles only;
- become available at an explicit timestamp;
- avoid future information and imagined intrabar fills;
- be evaluated after fees and adverse-fill assumptions; and
- demonstrate incremental value against simpler alternatives on unseen data.

If no candidate passes those checks, the correct result is `NO WINNER`—not another round of tuning until a favorable backtest appears.

## Current model status

### Production replay: transparent rejected baseline

The original replay remains available because it implements the requested mechanics and makes its behavior auditable. It combines one causal EMA trend trade with small, explicitly labelled activity probes. Whether an individual replay meets the profitability and minimum-trade thresholds is reported from that run; the model is a baseline and evaluator demonstration, not a validated profitable strategy.

Repeated historical research did not establish durable positive expectancy for this model or the subsequent v2–v5 families. The interface therefore reports results without describing the baseline as recommended or validated.

### v6: experimental anchored-VWAP/relative-volume family

The current v6 research hypothesis asks whether an unusually high-volume minute establishes a useful market reference:

1. Detect an exceptional completed one-minute volume event relative to the preceding 1,440-minute median.
2. Anchor a cumulative volume-weighted average price at that event.
3. Wait exactly 60 completed minutes.
4. Consider a long entry only when price remains above the anchored VWAP and subsequent volume participation is sufficient.
5. Fill only at the next minute's open.
6. Exit after a confirmed loss of the same anchored VWAP, after 12 hours, or at the UTC day boundary.

Exactly three fixed relative-volume thresholds are registered: 3×, 5×, and 8×. Each genuine paper position uses 25% of account equity and allows at most one open position and two round trips per UTC day. Any future evaluation must include base, 5 bp-per-fill, and 10 bp-per-fill adverse execution scenarios.

Each v6 buy targets exactly 25% of that candidate's paper-account equity immediately before its fill, including the 0.10% fee model. It is approximately $2,500 only at the initial $10,000 balance; subsequent USD notional and BTC quantity are derived from replayed cash, holdings, realized fills, and current mark price. Tiny qualification probes remain clearly separated and are never represented as alpha.

v6 shadow observation is implemented, experimental, unvalidated, and paper-only. It must not replace the production baseline unless the implementation remains verified and all evidence gates pass.

## Readability and decision transparency

Every model state should make the following understandable to a non-technical reader:

- what the model observed;
- which rules passed or failed;
- why it entered, waited, abstained, or exited;
- whether the signal is a rejected baseline, experimental shadow observation, or validated decision;
- the intended position size in USD and estimated BTC;
- the relevant reference price and invalidation/exit logic;
- fees, proceeds, and net profit or loss; and
- the limits of the evidence.

The product avoids fake controls, hidden scoring, probability-like labels that are not probabilities, and discretionary pattern names without deterministic rules.

## Evidence standard

A strategy is not promoted because it wins one replay or reaches a high trade win rate. A candidate must demonstrate positive net expectancy, positive mean and median returns, profit factor above one, acceptable drawdown and concentration, sufficient independent days and genuine trades, robustness to fees and adverse fills, and improvement over declared benchmarks.

The research sequence is:

1. Freeze the complete candidate definition before viewing outcomes.
2. Validate data provenance, candle continuity, causality, and accounting.
3. Evaluate chronological development and validation periods.
4. Open one untouched final test only for a fully qualified candidate.
5. Obtain independent implementation and accounting review.
6. Require a subsequent unchanged paper-forward period before promotion.

Previously explored datasets are retired from new inference rather than repeatedly mined for a winner.

## Run from a fresh clone on a clean Mac

Prerequisites:

1. Git (included with Xcode Command Line Tools; install with `xcode-select --install` if needed).
2. Node.js 20.9 or newer; Node.js 22 LTS is recommended. With Homebrew: `brew install node@22`.

One command clones the repository, installs the locked dependencies, fetches fresh public BTC/USD data, runs the latest completed 24-hour replay, and prints the full ledger:

```sh
git clone https://github.com/adamasata/btc-paper-trading-bot.git && cd btc-paper-trading-bot && npm ci && npm run demo
```

No account, API key, configuration file, or real funds are required.

To launch the local web interface after cloning:

```sh
npm ci && npm run dev
```

Then open `http://localhost:3000` and select **Run latest 24h**.

Production build:

```sh
npm run build
npm start
```

## Data and execution model

- Production replay primary feed: Binance.US public `BTCUSD` one-minute klines, fetched in bounded requests.
- v6 shadow feed: Bitstamp public `BTC/USD` one-minute OHLC, fetched in exact bounded pages. Its frozen positive-volume and contiguous-bar contract is never interpolated or relaxed; structurally invalid provider data returns a fail-closed shadow observation. Bitstamp can block this runtime (including HTTP 403) or rate-limit public traffic, so v6 availability is not guaranteed and transport failures surface as temporary unavailability rather than substituted data.
- Replay fallback: Coinbase Exchange public `BTC-USD` one-minute candles, fetched in bounded requests appropriate to its response limit.
- Replay window: 1,440 complete one-minute candles ending at the latest completed UTC minute. The in-progress candle is excluded.
- Timing: after minute `i` closes, a decision may use history through `i` only. Any order fills at minute `i + 1`'s open.
- No fantasy fills: candle highs and lows are never used as executable prices.
- Accounting: buy fees are included in the allocation; sell fees are deducted from proceeds; retained reserves remain in USD.
- Flat boundary: ending BTC is always zero after an explicit final close when required.
- Availability protection: the replay endpoint coalesces short concurrent refreshes and applies a best-effort in-process request limit. This is not a distributed production rate limiter.

## Baseline replay rules

The production replay preserves the originally requested behavior and remains isolated from v6 research.

1. After 60 completed candles, the core may enter at the next open when EMA10 is above EMA20, the completed close is above EMA60, and EMA60 is above its value ten minutes earlier.
2. The core exits at the next open after an observed +0.25% return, an observed −0.25% return, a bearish EMA10/EMA20 cross, or a 60-minute maximum hold.
3. Six predeclared activity-probe opportunities occur every 240 minutes after warm-up. If flat and not displaced by a core fill, each probe uses 0.1% of available cash and holds for ten minutes. They are evaluator mechanics, not alpha.
4. All positions are closed inside the replay window.

The activity requirement can incentivize costly churn. The demo keeps that compromise visible instead of disguising it as strategy performance.

## Original acceptance criteria and constraint preserved

The original task requires the bot to:

- start each rolling 24-hour replay with $10,000;
- finish above $10,000 after fees for a replay to count as profitable;
- complete at least five buy-and-closing-sell round trips;
- hold zero BTC at the end;
- charge 0.10% on every buy and sell;
- remain long-only, without leverage or shorting;
- use no look-ahead information;
- fetch real public market data itself;
- rerun with one command and no edits; and
- print every trade plus aggregate performance and buy-and-hold comparison; and
- fit the original four-hour hands-on implementation time box.

The product displays the underlying metrics needed to assess these criteria; it does not promise that every future run will meet them.

## Limitations

This is paper trading and research, not investment advice or autonomous live trading. Candle replays do not fully model bid/ask spread, queue position, partial fills, latency, market impact, outages, or exchange-specific trading limits. Adverse-fill scenarios improve realism but do not make OHLCV equivalent to an executable order book.

A current technical state is descriptive, not proof of predictive value. A profitable historical window can occur by chance, and a high win rate can still lose money when losses and transaction costs are larger than wins.

## Development checks

```sh
npm audit --omit=dev --audit-level=high
npm test
npm run lint
npm run build
npm run demo
```

Tests cover strategy causality, future-candle mutation, completed-bar handling, fees, partial allocation and reserve reconciliation, execution timing, forced-flat accounting, provider validation, research data integrity, cost scenarios, immutable artifacts, partition protection, and statistical controls.

## Tooling

Implemented with Hermes Agent, Athena, and standard Next.js/TypeScript tooling.
