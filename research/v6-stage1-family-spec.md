# BTC/USD v6 Stage 1 preregistration — endogenous anchored-VWAP volume-acceptance family

**Status:** frozen design; outcome-blind.  
**Permitted evidence for this document:** only the supplied v6 literature brief and v6 reconciliation memo. No legacy or new price, volume, trade, benchmark, holdout, or outcome file was opened, loaded, scored, charted, or summarized.

## 1. Decision, scope, and quarantine

Stage 1 contains one conceptual family and exactly three candidates. It tests whether an **endogenous, unusually high validated-volume minute establishes an anchored volume-weighted reference price (AVWAP), followed by sustained volume participation and price acceptance above that reference**. It is not a directional-return, pullback, breakout, range-reversion, candle-streak, opening-range, time-of-day, EMA, or generic volatility-expansion rule.

The old 30-day persisted corpus, including every unscored legacy segment, is permanently excluded from v6 inference. The v6 data-selection path must reject any legacy candle, normalized legacy bar, indicator cache, feature table, summary, benchmark, ledger, or outcome-derived configuration. A path/hash-only quarantine record may show that legacy material exists, but may not expose or load its contents.

No result can select a fourth candidate, alter a value below, add a filter, change the source, relax a validation rule, or change a partition. A failure produces `NO QUALIFIER`; it does not authorize a same-data revision.

## 2. Candidate registry and multiplicity family

All candidates use the same mechanics except for the single coarse anchor-volume multiplier `k`.

| Candidate ID | `k`: anchor-volume multiplier | Why it is included in the multiplicity family |
|---|---:|---|
| `v6-avwap-vrel3-accept60-a025` | 3 | Lower coarse definition of an exceptional validated-volume event. |
| `v6-avwap-vrel5-accept60-a025` | 5 | Central coarse definition; not a default winner. |
| `v6-avwap-vrel8-accept60-a025` | 8 | Higher coarse definition, testing whether only very unusual participation is informative. |

The registered family size is exactly **three**, including candidates that never trade, fail data validation, or fail a gate. `k` is not optimized, interpolated, ranked post hoc, or expanded. The three specifications count jointly in every Holm adjustment, White-style best-model test, effective-trial/Deflated-Sharpe report, and full trial ledger.

## 3. New-data contract and immutable partition schedule

Before the first new forward candle is fetched or scored, write and hash a registry containing: candidate IDs and this specification hash; UTC cutoff timestamp; provider, product, API query bounds, interval, and raw/normalized artifact hashes; software commit and lockfile hash; calendar partitions; cost table; bootstrap seed and block-length rule; and the independent equivalence-review record in section 12.

* **Source:** one newly acquired, strictly contiguous, single-provider `BTC/USD` one-minute OHLCV stream beginning strictly after the registry cutoff. A `BTC/USDT` proxy, if unavoidable, is a separately labelled later program and cannot be pooled with BTC/USD.
* **Bar acceptance:** retain a one-minute bar only when its UTC open timestamp is exactly one minute after the prior accepted bar; its close timestamp equals open plus one minute; all O/H/L/C/V fields are finite; `V > 0`; `H >= max(O,C,L)`; `L <= min(O,C,H)`; and `H >= L`. Reject duplicate, missing, unordered, incomplete/current, malformed, or nonpositive-volume bars. Never interpolate or forward-fill a missing minute.
* **Warm-up:** the first 90 complete UTC calendar days after the cutoff are feature warm-up only. They supply trailing estimators but are not a scoring, selection, benchmark, or reported-performance partition.
* **Stage-1 primary scoring set:** the next 60 disjoint complete UTC calendar days, `00:00:00` through `23:59:59`, partitioned before collection into twelve chronological five-day validation blocks. They are the only primary Stage-1 selection observations.
* **Purge/embargo:** before each five-day block, embargo the immediately preceding full UTC day from aggregate scoring and selection. This exceeds the maximum permissible 12-hour hold and prevents a feature/position bridge. The 90-day warm-up remains available only for trailing feature calculation. Primary blocks never overlap.
* **Diagnostic offsets:** 06:00, 12:00, and 18:00 shifted 24-hour windows may be reported only after the primary decision is frozen; they are correlated diagnostics, cannot alter selection, and add zero to `N` or trial count.

If the stream cannot provide the stated contiguous schedule, Stage 1 is `INSUFFICIENT EVIDENCE`, with no substituted legacy data and no shorter schedule.

## 4. Timing convention and feature availability

Let minute bar `i` have completed fields `(O_i,H_i,L_i,C_i,V_i)` and close at time `e_i`. Every feature indexed `t` may use accepted bars with `e_i <= e_t` only. It becomes available immediately after `e_t`; no value from the still-forming minute `t+1` or later may enter it.

Define typical price `P_i = (H_i + L_i + C_i)/3`. All times are UTC. A signal decided from completed bar `t` executes, if allowed, at **the open of bar `t+1`**. An exit decided from completed bar `t` likewise sells at the open of bar `t+1`. There are no intrabar stop, limit, high, low, or close fills.

## 5. Mandatory volume constructs and anchor definition

For every eligible completed minute `t`, define the trailing-only 24-hour positive-volume median

`M_t = median(V_{t-1440}, ..., V_{t-1}).`

`t` is eligible only if all 1,440 referenced accepted one-minute bars exist. It is an **anchor event** for candidate multiplier `k` exactly when

`V_t >= k * M_t`.

The current completed bar's volume is used only on the left side after its close. The median excludes `V_t`; it has no future bars, no percentile threshold, no cross-provider normalization, and no fitted parameter.

For an anchor at `a` and a later completed minute `t >= a`, define the endogenous AVWAP

`AVWAP_{a,t} = [sum(i=a..t, P_i * V_i)] / [sum(i=a..t, V_i)].`

Both `V_t` and the anchor event are mandatory information: an entry is impossible without a valid relative-volume anchor, and `AVWAP` itself is volume-weighted. The additional mandatory participation check is

`Q_{a,t} = sum(i=a+1..t, V_i) / V_a`.

No moving average, EMA, return sign, candle streak, wick threshold, price-range breakout, realized-volatility trigger, session/opening range, or clock-time condition is part of the signal.

## 6. Endogenous anchor selection, signal, and entry

At the start of each UTC day, the strategy is flat, has no active anchor, and its filled-entry count is zero. While flat and fewer than two entries have filled that day, scan accepted completed bars in chronological order. The first anchor event strictly after the last terminal anchor disposition (start of day, a failed 60-minute assessment, or an exit fill) becomes active anchor `a`; later events are ignored while that anchor is active. A failed 60-minute assessment expires that anchor and permits a later anchor event. After an exit fill, a later anchor must have a close timestamp strictly after the exit-fill minute. There are at most two filled entries and two completed round trips per UTC day.

At exactly anchor age 60 completed minutes (`t = a + 60`), evaluate once:

1. all bars `a..t` must be accepted;
2. `C_t > AVWAP_{a,t}`; and
3. `Q_{a,t} >= 1`.

If and only if all three conditions hold and it is before the boundary-entry cutoff below, buy at `O_{t+1}` and increment the daily filled-entry count. This is the sole entry decision for that anchor. There is no crossover scan, retry, recovery condition, or entry based on the same anchor. If a condition fails, expire that anchor; if no later permissible anchor produces a fill, mark the day `no-signal` and remain flat through the boundary.

**Boundary-entry cutoff:** do not enter if `t+1` opens at or after `12:00:00 UTC`. This mechanical cutoff guarantees enough observable holding time; it is identical for every candidate and is not an alternate anchor, directional time bias, or selection dimension.

## 7. Position management, allocation, exits, and no-signal handling

* **Allocation:** at an entry, buy BTC notional equal to exactly 25% of account equity immediately before the buy fill, inclusive of no leverage. The remaining account stays cash. There is at most one open position; while long, all anchors/signals are ignored.
* **Exit condition:** beginning with the first completed minute after entry, evaluate only at 30-minute ages from the entry decision bar. At an evaluation bar `t`, sell at `O_{t+1}` if `C_t <= AVWAP_{a,t}`. This is a close-confirmed loss of the original volume-weighted acceptance reference, not a stop fill at a price extreme.
* **Maximum holding period:** if still long at the completed bar exactly 12 hours after the entry fill minute, sell at the next minute open. If both AVWAP exit and maximum-hold exit arise, there is one sell at that same next open.
* **Boundary flat:** independently of the foregoing, any remaining long position is sold at the `00:00:00 UTC` open beginning the next primary day. No position spans a UTC scoring boundary. Boundary closure takes precedence over all other exits.
* **No-signal/invalid day:** a day with no valid permissible anchor, no passed 60-minute check, a cutoff-precluded entry, or no admissible execution is a zero-return, zero-trade primary observation. It is reported separately as `no-signal`, is included as zero in daily-return mean/median and bootstrap series, and is non-positive for the positive-day count. It must never be silently dropped or counted as positive.
* **Data integrity interruption:** any missing/malformed bar needed by an active anchor, AVWAP, participation calculation, signal, or open position invalidates the affected candidate/day and triggers the causal/data stop rule; it is not converted to a favorable no-trade outcome.

The two-entry daily cap, 12-hour maximum hold, and forced boundary flat cap the strategy at two round trips per UTC day and are intended to keep turnover low under the stated fee model while leaving the registered 100-trade evidence threshold attainable over 60 days.

## 8. Costs and fill accounting

For each registered scenario `s` in `{0, 0.0005, 0.0010}`, where `s` is adverse fill stress per fill:

* Buy execution price: `B = O_{t+1} * (1 + s)`.
* Sell execution price: `S = O_{u+1} * (1 - s)`.
* Apply fee `f = 0.001` to each buy and each sell cash flow, separately.

Base is `s=0`; stresses are +5 bp/fill and +10 bp/fill. They are scenario assumptions, not claims about observed slippage. Ledger each fill with decision timestamp, open-fill timestamp, raw open, stressed execution price, fee, quantity, anchor timestamp, candidate ID, and exit reason. Long-only; no borrowing, shorting, leverage, or fractional additional sleeve is permitted.

## 9. Benchmarks and comparator accounting

Every benchmark uses the identical accepted source bars, UTC primary days, invalid-data policy, 25% sleeve accounting, next-minute-open convention, fee model, adverse-fill scenarios, and boundary-flat rule.

1. **Cash:** 0% daily sleeve return, no fills.
2. **Forced-flat buy-and-hold:** buy the 25% sleeve at the first accepted minute open of each scoring day and sell at the next UTC boundary open, with both fees and stresses.
3. **Simple trailing-24-hour long/cash momentum:** at each scoring-day first minute, long for that day only when the preceding 1,440 accepted completed one-minute bars give `C_{-1}/C_{-1440}-1 > 0`; otherwise cash. Buy/sell at the same daily next-open/boundary convention and costs.
4. **Anchor-only ablation:** use the same valid endogenous-anchor sequence, 60-minute wait, participation condition, allocation, two-entry daily cap, and boundary rule, but omit `C_t > AVWAP_{a,t}` at entry and omit the AVWAP-loss exit; exit only by 12-hour maximum hold or boundary. It isolates the claimed incremental AVWAP acceptance rule while retaining volume-event selection.

The primary benchmark-relative series is each candidate’s daily net sleeve return minus the simple trailing-24-hour long/cash momentum daily net sleeve return. Cash, forced-flat buy-and-hold, and the anchor-only ablation remain required gates, not optional narrative comparators.

## 10. Selection, multiplicity, falsification, and stop rules

All three candidates are calculated causally on each predeclared primary block. No candidate is chosen within a block and then retroactively rescored. The daily series includes all 60 scoring days and the embargo days are excluded from every primary aggregate.

### Acceptance gates for a Stage-1 qualifier

One candidate may qualify only if it has all of the following across the 60 primary days:

1. at least 100 genuine completed trades (a buy paired with a permitted sell);
2. positive mean daily net return, positive median daily net return, and positive per-trade net expectancy under base, +5 bp/fill, and +10 bp/fill scenarios;
3. profit factor greater than 1 under all three scenarios;
4. strictly positive mean daily excess return versus the simple momentum benchmark, cash, forced-flat buy-and-hold, and anchor-only ablation under all three scenarios;
5. no single primary day or five-day block contributes more than 25% of aggregate candidate P&L in any scenario;
6. a strictly positive lower bound of a two-sided 95% stationary/block-bootstrap confidence interval for the mean daily excess return versus the primary momentum benchmark, under each scenario;
7. a Holm-adjusted family-wise one-sided primary test at alpha `0.05` rejects non-positive mean daily excess return versus the momentum benchmark across the complete three-candidate family, under each scenario; and
8. all provenance, causal availability, raw/normalized-hash, fill-ledger, boundary-flat, and duplicate-fingerprint audits pass.

The stationary bootstrap uses the 60 daily primary returns, seed `20261023`, and mean block length `5` UTC days. It uses 20,000 resamples. The same bootstrap series and seed apply to each candidate/scenario; no block-length tuning is permitted. Report the complete candidate table, positive/negative/flat/no-signal day counts, Wilson 95% interval for positive-day rate, trade win rate, mean/median, expectancy, PF, maximum drawdown, cost sensitivity, observed Sharpe with stated annualization, skewness/kurtosis, trial count, and Deflated/Probabilistic Sharpe only if estimable. Wilson results are descriptive and never a selection target.

For the three base-scenario daily excess-return series, also run a stationary-bootstrap White-style best-model reality check against the primary momentum benchmark, with the same seed/block length and exploratory alpha `0.05`. This report does not replace the stricter per-candidate Holm gate. Report PBO/CSCV only if at least 16 independent contiguous blocks exist; otherwise state `PBO unavailable`.

### Falsification tests

A candidate is falsified and cannot qualify if any condition below occurs:

* **AVWAP necessity:** it fails to beat its anchor-only ablation under any cost scenario, or the ablation is equal/better on the primary excess-return criterion.
* **Cost fragility:** any registered adverse scenario has non-positive expectancy or non-positive mean/median daily return.
* **Participation fragility:** fewer than 100 completed genuine trades occur; extend forward time unchanged rather than reducing the threshold, shortening the hold, or adding a candidate.
* **Concentration:** a day/block exceeds the 25% P&L concentration cap.
* **Multiplicity failure:** the complete three-candidate Holm gate or White-style best-model test fails.
* **Causal/data failure:** any feature uses a current/incomplete bar before its close, future bar, cross-provider volume, interpolated bar, unobservable intrabar fill, incorrect next-open fill, overlapping position, or boundary carry.
* **Equivalence failure:** the independent v1–v5 review finds the candidate duplicates a retired strategy under section 12.

Stop Stage 1 and emit `NO QUALIFIER` without accessing a final test or any legacy data if no candidate clears every acceptance gate, any registered item changes after first primary output, primary blocks overlap/reuse or violate embargo, any integrity/equivalence audit fails, or the data/trade minimum is unmet. Retire all Stage-1 scoring partitions after the decision.

## 11. Final-test and forward-paper boundary

Only exactly one frozen qualifying candidate may proceed. Before any final-test access, freeze its ID, immutable code commit, scenario table, final-test start/end timestamps, and hashes. The strictly later final test is 30 consecutive UTC days with at least 50 genuine completed trades and all Stage-1 gates reapplied. It is run once. Failure, rerun, or any prompted modification emits `NO WINNER` and permanently retires that partition.

A final-test pass is not production authorization. It requires at least 90 further consecutive unchanged forward-paper days and 100 further genuine trades before any paper-production decision. Low turnover extends time; it never changes parameters or reduces evidence requirements.

## 12. Duplicate fingerprints and conservative v5 equivalence analysis

### v6 family fingerprint

`data=validated single-provider 1m OHLCV; mandatory-information={relative current-minute volume versus prior-1440-minute median, endogenous relative-volume event anchor, cumulative typical-price×volume AVWAP from that anchor, post-anchor cumulative-volume participation}; entry={one fixed 60-minute post-event assessment per anchor, close above event AVWAP, participation>=1, maximum two filled entries per UTC day}; exit={close-confirmed loss of same event AVWAP at 30-minute checks, 12h maximum, UTC boundary}; allocation=25% long/cash; execution=completed-bar decision/next-minute open; turnover<=2 round-trips per UTC day.`

The fingerprint explicitly excludes: price-return/trend filters, pullback/recovery logic, EMA/SMA signals, candle-count rules, range boundaries, opening/session range, fixed clock-time anchor choice, raw volatility-expansion trigger, and mean-reversion-to-a rolling range midpoint.

### Conservative v5 comparison

The supplied memo names retired v5 families as UTC opening-range breakout, session dip recovery, volatility-expansion continuation, daily time bias, long-horizon trend/pullback, and six-hour range mean reversion. On those names and the supplied descriptions alone, the v6 fingerprint has two required mechanisms not stated for v5: (1) an endogenous first validated relative-volume event and (2) a cumulative event-anchored VWAP plus post-event volume participation condition. It also has no return-sign, pullback, range, session-direction, EMA, or price-volatility condition. Therefore it is **provisionally non-equivalent by mandatory-information and trigger fingerprint**, not merely by label.

This is deliberately not a claim that the full retired v5 source was inspected. Before the first new v6 candle, an independent reviewer may inspect only frozen v1–v5 rule text/registries and candidate definitions—not outcome files, metrics, charts, or holdout data—and must append a signed syntax-level comparison. The reviewer must mark `DUPLICATE—STOP` if any retired rule requires the same conjunction of: relative-volume event selection, event-anchored cumulative volume-weighted price reference, post-anchor participation, and acceptance/loss around that same reference; or if it is behaviorally indistinguishable under all admissible OHLCV paths. If the reviewer cannot establish absence of that conjunction, equivalence remains unresolved and Stage 1 must stop without v6 data collection. The v1–v5 programs remain listed in the experiment ledger as prior retired research, regardless of the non-equivalence conclusion.

**Equivalence verdict:** `CONDITIONAL NON-EQUIVALENCE ONLY: v6 is eligible solely after the outcome-blind frozen-rule audit confirms that v1–v5 did not contain the mandatory relative-volume endogenous-anchor + cumulative AVWAP + participation/acceptance conjunction; otherwise DUPLICATE—STOP.`

## 13. Required artifacts

Produce, before data scoring, the registry hash, provider query manifest, raw and normalized OHLCV hashes, accepted/rejected-bar audit, code/lockfile hashes, equivalence-review record, exact partition calendar, feature-availability audit, scenario table, append-only candidate and trade ledgers, benchmark ledgers, bootstrap configuration/seed, full multiplicity table, and an immutable run manifest. Preserve failed/no-trade candidates and all no-signal days. No artifact may contain, import, or summarize legacy outcome data.
