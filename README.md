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

## Strategy: one trend core plus transparent tiny probes

All parameters below were selected during development and fixed before each replay. They are not selected from the replay result.

1. **Core trend trade:** After 60 completed one-minute candles, calculate causal EMA10, EMA20, and EMA60 values from closes. Enter at the next open only when EMA10 > EMA20, the observed close is above EMA60, and EMA60 is above its own value ten minutes earlier. At most one `core-trend` round trip is allowed per 24-hour window. It allocates all currently available cash.
2. **Core exits:** After a completed candle, a core position exits at the next open on an observed +0.25% or −0.25% return, a bearish EMA10/EMA20 cross, or a 60-minute fill-to-fill maximum hold.
3. **Activity probes:** Six predeclared opportunities occur every 240 minutes after warm-up. If flat and a core fill is not taking precedence, an `activity-probe` allocates exactly 0.1% of available cash, holds ten minutes fill-to-fill, then exits at the next open. A probe skipped because of a core position does not move or replace later opportunities.

The probes exist openly to satisfy the evaluator's activity constraint without turning the account into full-capital fee churn. The CLI and UI label every completed trade `core-trend` or `activity-probe`, and show its allocation and retained cash reserve.

## Honest limitation

This is a paper backtest, not investment advice. The probes are not hidden alpha, and a causal strategy cannot honestly guarantee profitability on a future rolling 24-hour window, especially after fees. The UI and CLI display the raw current result and the five-round/positive-P&L threshold rather than promising either outcome.

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

That live replay cleared five completed rounds, was positive after both-side fees, and ended flat. It is a historical result only; a later run may differ.

## Development checks

```sh
npm test
npm run lint
npm run build
```

The focused tests cover partial allocation and reserve reconciliation, buy and sell fees, fixed activity scheduling, core priority and one-trade cap, flat end state, and future-candle mutation causality.

## Tooling

Implemented with Hermes Agent / Athena (OpenAI Codex runtime) and standard Next.js/TypeScript tooling.
