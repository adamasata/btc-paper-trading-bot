export type Candle = {
  openTime: number;
  open: number;
  close: number;
};

export type StrategyParameters = {
  initialCash: number;
  feeRate: number;
  lookbackMinutes: number;
  entryZScore: number;
  exitZScore: number;
  takeProfitRate: number;
  stopLossRate: number;
  maxHoldMinutes: number;
  cooldownMinutes: number;
  fallbackEntryIntervalMinutes: number;
};

export type CompletedTrade = {
  id: number;
  buyTime: number;
  sellTime: number;
  buyPrice: number;
  sellPrice: number;
  quantityBtc: number;
  buyFeeUsd: number;
  sellFeeUsd: number;
  costUsd: number;
  proceedsUsd: number;
  profitUsd: number;
  profitPercent: number;
  exitReason: 'signal' | 'take-profit' | 'stop-loss' | 'time-limit' | 'forced-close';
};

export type BacktestResult = {
  trades: CompletedTrade[];
  finalBalanceUsd: number;
  profitUsd: number;
  profitPercent: number;
  buyAndHoldFinalUsd: number;
  buyAndHoldProfitUsd: number;
  totalFeesUsd: number;
  candleCount: number;
  firstCandleTime: number;
  lastCandleTime: number;
  parameters: StrategyParameters;
};
