# Decision Lab methodology v1

## Scope and data contract

Decision Lab v1 is a read-only BTC/USD research view. It fetches public Binance.US `BTCUSD` candles without an API key. The separate v6 shadow observer uses its own provider. Neither path submits orders, modifies the replay, or accesses account data.

The v1 output is binary: `ENTER LONG` only when every actioning prerequisite passes; otherwise `NO TRADE`. Missing, malformed, gapped, stale, or incomplete required candle data always resolves to `NO TRADE`. The action score measures action-rule coverage.

The deployed audit record is available at `/decision-methodology` and is linked from Decision Lab.

## v6 Stage-1 shadow observation

The frozen v6 anchored-VWAP/relative-volume family is an experimental shadow observer. `/api/v6-decision` reads exact bounded pages of contiguous completed Bitstamp BTC/USD one-minute candles and retains the frozen `V > 0` and no-interpolation contract. Structurally invalid data returns a fail-closed observation with `dataQualityPass=false`. Bitstamp transport failures, including HTTP 403 and rate limits, return temporary unavailability rather than substituted data. The endpoint reports all three preregistered 25%-allocation variants without altering `/api/decision`, `/api/run`, replay behavior, or v1. An `entry_ready` state is a next-minute-open intent. When that minute's open is causally observed, it becomes a recorded fill without reading that candle's later high, low, close, or volume. Each allocation is derived from the candidate's replayed account equity immediately before its own buy; ~$2,500 is only the approximate initial-account value.

## Fixed data contract

- Daily input: at least 220 contiguous, completed UTC daily Binance.US BTCUSD candles. The forming daily bar is excluded.
- Hourly input: at least 22 contiguous, completed UTC hourly Binance.US BTCUSD candles. The forming hourly bar is excluded.
- A candle is accepted only when its OHLC values are finite, positive, internally consistent, aligned to the expected UTC interval, and part of the required contiguous trailing range.
- The public read-only endpoint returns `public, s-maxage=60, stale-while-revalidate=60`. Its module-local 60-second cache/single-flight and rate limiter reduce duplicate upstream calls only within one runtime; they are best effort, not distributed production controls.

## Deterministic action sequence

1. **Required candle data quality.** Require the candle contract and latest completed daily/hourly boundaries. Any failure is an action-rule failure and therefore `NO TRADE`.
2. **Daily regime.** Calculate the latest completed daily 21-day SMA and SMA-seeded 21-day EMA. The regime is bullish only when the latest completed daily close is strictly above both. The 100-day and 200-day SMA values are displayed as context; v1 does not add undisclosed conditions to the action.
3. **Frozen higher-timeframe references.** Calculate two values once from completed daily closes before the current daily close: the prior seven-day mean and the prior 30-day mean. Of values at or below the latest completed hourly close, use the nearest (highest) as the eligible pivot.
4. **Hourly confirmation.** Calculate a standard Wilder 14-hour ATR and a 21-hour EMA from completed hourly bars. The 21-hour EMA is displayed as context only. A strict reclaim needs two completed hourly candles: the prior close must be at or below the frozen pivot; the latest candle low must trade to or below it; and the latest close must finish strictly above it.
5. **No chase and volatility.** The confirming close can be no more than 0.5 ATR above the reclaimed pivot. ATR must be at most 5% of the latest close. These thresholds are fixed implementation constraints.
6. **Action and execution.** Only every actioning condition above can produce `ENTER LONG`. A passing completed-candle setup is actionable only at its exact next UTC hourly boundary. At that exact boundary the service may provide the newly observed hourly open; it never consumes that candle's later high, low, or close. The open must remain above the pivot and within 0.5 ATR. Any intra-hour request after the boundary is `EXPIRED` and returns `NO TRADE`; a missing or failing boundary open is `REJECTED`. A valid `CURRENT` instruction expires four hours after that boundary. Risk and +1R/+2R targets use an actual fill only.

## Research program

The durable `research/` harness evaluates latest complete 30-day BTC/USD minute-candle data over UTC offsets 00:00, 06:00, 12:00, and 18:00. It records candidate families and grids before each run, selects only on the first 20 chronological days, leaves the final 10 days unevaluated unless a candidate qualifies, and reports both genuine and qualification-overlay P&L. See the versioned preregistration files and run artifacts under `research/` for protocols, provenance limits, and results.

## Source registry

Each record includes a direct URL, the recorded material, its Decision Lab mapping, and retrieval notes.

1. **The #1 Bitcoin Indicator You Need To Watch To Predict Price** — DataDash / Nicholas Merten — 2024-04-24. [Direct video](https://www.youtube.com/watch?v=ph7TMt-zIio). Recorded material: 21-day SMA+EMA pocket, 100/200 MA context, and oscillators as nondeterministic context. Mapping: completed 21-day moving-average display and 100/200-day context.
2. **YouTube source n6oAJKwHcNo (title not independently retrieved)** — DataDash / Paul Sampson — 2025-02-06. [Direct video](https://www.youtube.com/watch?v=n6oAJKwHcNo). Recorded material: frozen prior-session averages and Fibonacci/range discussion. Mapping: frozen prior close-mean references.
3. **Bitcoin Is About to Shock Everyone... The Breakout Has Begun** — DataDash / Paul Sampson — 2026-08-20. [Direct video](https://www.youtube.com/watch?v=JcBUcSiRZmI). Recorded material: close confirmation, fixed 180-day average, invalidation, and no-chase framing. Mapping: completed-close confirmation and no-chase/invalidation handling.
4. **YouTube source mH9o6zAoSw0 (title not independently retrieved)** — creator not independently retrieved — publication date unknown. [Direct video](https://www.youtube.com/watch?v=mH9o6zAoSw0). Retrieval note: publication date and metadata are unavailable in this registry.
5. **YouTube source iGC1KVUU5sI (title not independently retrieved)** — creator not independently retrieved — publication date unknown. [Direct video](https://www.youtube.com/watch?v=iGC1KVUU5sI). Retrieval note: publication date and metadata are unavailable in this registry.
6. **YouTube source 2Yni82DI-qQ (title not independently retrieved)** — creator not independently retrieved — publication date unknown. [Direct video](https://www.youtube.com/watch?v=2Yni82DI-qQ). Retrieval note: publication date and metadata are unavailable in this registry.
7. **DataDash X status 2105311203123695819** — DataDash — publication date not independently retrieved. [Direct post](https://x.com/datadashpro/status/2105311203123695819). Retrieval note: X access and displayed metadata can vary by viewer/session.
8. **Paul X status 2100975556300767234** — Paul Sampson — publication date not independently retrieved. [Direct post](https://x.com/paulsampson0x/status/2100975556300767234). Retrieval note: X access and displayed metadata can vary by viewer/session.
