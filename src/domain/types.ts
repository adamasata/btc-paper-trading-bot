export type Candle = {
  openTime: number;
  open: number;
  close: number;
};

export type TradeKind = 'core-trend' | 'activity-probe';

export type StrategyParameters = {
  initialCash: number;
  feeRate: number;
  historyBars: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;
  emaTrendPeriod: number;
  emaTrendSlopeMinutes: number;
  coreTakeProfitRate: number;
  coreStopLossRate: number;
  coreMaxHoldMinutes: number;
  coreTradeLimitPerWindow: number;
  activityProbeIntervalMinutes: number;
  activityProbeCount: number;
  activityProbeAllocationRate: number;
  activityProbeHoldMinutes: number;
};

export type ExitReason = 'take-profit' | 'stop-loss' | 'bearish-cross' | 'time-limit' | 'scheduled-exit' | 'forced-close';

export type CompletedTrade = {
  id: number;
  kind: TradeKind;
  buyTime: number;
  sellTime: number;
  buyPrice: number;
  sellPrice: number;
  quantityBtc: number;
  allocatedCashUsd: number;
  reserveCashUsd: number;
  buyFeeUsd: number;
  sellFeeUsd: number;
  costUsd: number;
  proceedsUsd: number;
  profitUsd: number;
  profitPercent: number;
  exitReason: ExitReason;
};

export type BacktestResult = {
  trades: CompletedTrade[];
  finalBalanceUsd: number;
  endingBtc: number;
  profitUsd: number;
  profitPercent: number;
  buyAndHoldFinalUsd: number;
  buyAndHoldProfitUsd: number;
  totalFeesUsd: number;
  coreTradeCount: number;
  activityProbeTradeCount: number;
  candleCount: number;
  firstCandleTime: number;
  lastCandleTime: number;
  parameters: StrategyParameters;
};
