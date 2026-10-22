# Lumen — BTC/USD paper replay

A small, runnable BTC/USD paper-trading demo. It replays the most recent **completed** 24 hours of one-minute candles with USD 10,000, long-only, no leverage, 0.10% fee on every buy and sell, and an explicit flat-at-end close.

## Run on a clean Mac

Prerequisite: Node.js 20.9+ (Node 22 LTS recommended).

```sh
npm ci && npm run demo
```

That one command fetches fresh public BTC/USD candles and prints the full ledger. To use the hosted-style local interface instead:

```sh
npm ci && npm run dev
```

Then open `http://localhost:3000` and press **Run latest 24h**. No API key, account, or funds are used. `npm run build` produces the production build; `npm start` serves it after building.

## Data and execution model

- Primary feed: Binance.US public `BTCUSD` one-minute klines, in exactly two bounded 12-hour requests.
- Fallback: Coinbase Exchange public `BTC-USD` one-minute candles, in six bounded four-hour requests (the endpoint caps each response).
- Window: the 1,440 complete minute candles ending at the last completed UTC minute. The in-progress candle is excluded.
- Decision timing: after minute *i* closes, using history through minute *i* only; any order fills at minute *i + 1*'s **open**. Candles' high/low are never used for fills.
- Accounting: whole available cash is allocated when long; position size includes the buy fee, sell fee is deducted from proceeds, and no BTC remains after the final close.

## Strategy

The fixed-before-run rule is a 30-minute mean-reversion scalp:

1. After 30 completed closes, calculate the current close's z-score against the preceding 30 closes.
2. Enter long at the next open when the observed z-score is at or below -3.0. Six fixed four-hour participation opportunities are also defined before the run so the replay has predictable, testable minimum activity rather than choosing trade times after seeing outcomes.
3. Exit at the next open after a 0.32% observed move, a positive recovery z-score with at least a fee-aware 0.25% move, a 0.65% stop, or a 10-minute holding limit. A final position is sold at the last candle's close and marked `forced-close`.

The strategy was intentionally kept simple and inspectable rather than selected from the replay result. I rejected same-candle closes/highs/lows because those create an unrealistic look-ahead fill. Fees make short-horizon BTC scalping difficult; the ledger deliberately reports losses rather than hiding them.

## Honest limitation

No causal strategy can honestly guarantee a profit on every future rolling 24-hour interval, especially after fees. This repo does **not** claim that it can. The UI and CLI show the raw, current result and mark whether a particular run cleared the five-round/positive-P&L take-home threshold. It is a paper backtest, not investment advice.

## Example local run

Run at 2026-10-22 16:15 UTC, Binance.US, window `2026-10-21T16:15:00Z` through `2026-10-22T16:15:00Z`:

| Metric | Result |
| --- | ---: |
| Complete one-minute candles | 1,440 |
| Completed round trips | 17 |
| Final USD balance | $9,588.62 |
| Net P/L | -$411.38 (-4.11%) |
| Buy-and-hold final value | $9,622.74 (-$377.26) |
| Fees paid | $332.90 |
| Ending BTC | 0.000000 |

The CLI prints each buy/sell timestamp and price, BTC size, combined fee, exit reason, and USD/% P&L. That exact run had at least five round trips and ended flat, but it was not profitable; this is retained as an honest result rather than a cherry-picked simulation.

## Development checks

```sh
npm test
npm run lint
npm run build
```

The focused tests cover fee inclusion, a causal-signal future mutation check, a representative fixture with five or more completed rounds, and the forced-flat final close.

## Tooling

Implemented with Hermes Agent / Athena (OpenAI Codex runtime) and standard Next.js/TypeScript tooling.
