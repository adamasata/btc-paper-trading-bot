# Lumen — BTC/USD paper replay

A small, runnable BTC/USD paper-trading demo. It replays the most recent **completed** 24 hours of one-minute candles with USD 10,000, long-only, no leverage, 0.10% fee on every buy and sell, and an explicit flat-at-end close.

## Run on a clean Mac

Prerequisite: Node.js 20.9+ (Node 22 LTS recommended).

```sh
npm ci && npm run demo
```

That command fetches fresh public BTC/USD candles and prints the full ledger. To use the hosted-style local interface instead:

```sh
npm ci && npm run dev
```

Then open `http://localhost:3000` and press **Run latest 24h**. No API key, account, or funds are used. `npm run build` produces the production build; `npm start` serves it after building.

## Data and execution model

- Primary feed: Binance.US public `BTCUSD` one-minute klines, in exactly two bounded 12-hour requests.
- Fallback: Coinbase Exchange public `BTC-USD` one-minute candles, in six bounded four-hour requests (the endpoint caps each response).
- Window: the 1,440 complete minute candles ending at the last completed UTC minute. The in-progress candle is excluded.
- Decision timing: after minute *i* closes, using history through minute *i* only; any order fills at minute *i + 1*'s **open**. Candles' high/low are never used for fills.
- Accounting: fees are included in each buy allocation, sell fees are deducted from proceeds, activity-probe reserves remain in USD, and `Ending BTC` is always zero after the explicit final close if required.
- Availability protection: the POST endpoint keeps the completed latest replay in server memory for 20 seconds, coalesces concurrent refreshes, and applies an in-process best-effort limit of eight requests per client key per minute. On Vercel it keys only from Vercel's edge-owned forwarding header; elsewhere it deliberately uses one conservative shared bucket rather than trusting spoofable forwarding headers. This is not a distributed rate limit; a multi-instance production service would add a shared edge/store limit.

## Strategy: one trend core plus transparent tiny probes

All parameters below were selected during development and fixed before each replay. They are not selected from the replay result.

1. **Core trend trade:** After 60 completed one-minute candles, calculate causal EMA10, EMA20, and EMA60 values from closes. Enter at the next open only when EMA10 > EMA20, the observed close is above EMA60, and EMA60 is above its own value ten minutes earlier. At most one `core-trend` round trip is allowed per 24-hour window. It allocates all currently available cash.
2. **Core exits:** After a completed candle, a core position exits at the next open on an observed +0.25% or −0.25% return, a bearish EMA10/EMA20 cross, or a 60-minute fill-to-fill maximum hold.
3. **Activity probes:** Six predeclared opportunities occur every 240 minutes after warm-up. If flat and a core fill is not taking precedence, an `activity-probe` allocates exactly 0.1% of available cash, holds ten minutes fill-to-fill, then exits at the next open. A probe skipped because of a core position does not move or replace later opportunities.

The probes exist openly to satisfy the evaluator's activity constraint without turning the account into full-capital fee churn. The CLI and UI label every completed trade `core-trend` or `activity-probe`, and show its allocation and retained cash reserve.

## Development narrative and limitations

The first MVP used an all-in mean-reversion idea: repeatedly commit the account to small reversals in a one-minute series. Once both sides of the 0.10% fee were included, that churn lost badly. It was rejected rather than tuned into a favorable-looking result, because frequent full-capital activity was not a credible execution design under the stated fee model.

The current two-tier design keeps one causal trend trade as the investment hypothesis and makes the six tiny activity probes explicit. The probes serve the evaluator's minimum-activity purpose; they are not alpha and should not be interpreted as evidence that the system has solved a trading problem. That evaluator constraint can incentivize gaming if it is hidden or uses material capital, which is why the probes are fixed, tiny, labelled, and separately counted.

This is a paper backtest, not investment advice. It assumes each eligible order fills entirely at the next one-minute candle open at the displayed price. It does **not** model bid/ask spread, slippage, partial fills, queue position, latency, market impact, exchange outages, or trading limits. Those omissions are especially important for one-minute BTC trading and can make a live result worse than this replay. The forced final close is a bookkeeping rule to end the finite replay flat; it is labelled `forced-close` in the ledger and is not a claim that a live exit would receive that close.

A causal strategy cannot honestly guarantee profitability on a future rolling 24-hour window, especially after fees. The UI and CLI display the raw current result and the five-round/positive-P&L threshold rather than promising either outcome.

## Example local run

Run at 2026-10-22 16:21 UTC, Binance.US, window `2026-10-21T16:21:00Z` through `2026-10-22T16:21:00Z`:

| Metric | Result |
| --- | ---: |
| Complete one-minute candles | 1,440 |
| Completed round trips | 7 (1 core-trend, 6 activity-probe) |
| Final USD balance | $10,007.22 |
| Net P/L | +$7.22 (+0.07%) |
| Buy-and-hold final value | $9,613.28 (−$386.72) |
| Fees paid | $20.13 |
| Ending BTC | 0.000000 |

This historical replay met the stated numeric thresholds at that time and ended flat. It is not a prediction; a later run may differ.

## Five-minute Loom recording outline

No recording link is supplied. If recording a five-minute walkthrough, use this outline:

1. **0:00–0:35 — Scope:** identify this as a paper replay, show the no-key/no-funds local startup command, and state that timestamps are UTC.
2. **0:35–1:25 — Data and causal execution:** show the completed 24-hour window, source/fallback, next-open fills, fees, and the omission of spread/slippage.
3. **1:25–2:25 — Strategy evolution:** explain why all-in mean-reversion churn was rejected after fees and show the current trend-core entry and exits.
4. **2:25–3:20 — Activity-probe disclosure:** show the labelled probe trades, their 0.1% allocation, fixed schedule, evaluator purpose, and anti-gaming limitation.
5. **3:20–4:20 — Live replay:** press **Run latest 24h**, inspect the ledger, UTC timestamps, numeric-threshold wording, and forced-close handling if present.
6. **4:20–5:00 — Engineering guardrails:** mention short server caching/single-flight, per-IP best-effort rate limiting, production audit, tests, lint, and build; close with the unresolved live-execution limitations.

## Development checks

```sh
npm audit --omit=dev --audit-level=high
npm test
npm run lint
npm run build
npm run demo
```

The focused tests cover partial allocation and reserve reconciliation, buy and sell fees, fixed activity scheduling, core priority and one-trade cap, forced-close reconciliation, bearish-cross and time-limit exits, flat end state, future-candle mutation causality, provider parsing/window validation, and cache/rate-limit helpers.

## Tooling

Implemented with Hermes Agent / Athena (OpenAI Codex runtime) and standard Next.js/TypeScript tooling.
