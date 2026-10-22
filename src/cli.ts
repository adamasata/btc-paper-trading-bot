import { runBacktest } from './domain/backtest';
import { fetchLatest24h } from './lib/market-data';

const money = (value: number) => `$${value.toFixed(2)}`;
const when = (value: number) => new Date(value).toISOString();

async function main(): Promise<void> {
  const market = await fetchLatest24h();
  const result = runBacktest(market.candles);
  console.log(`BTC/USD 24h paper replay — ${market.source}`);
  console.log(`Window: ${when(market.startTime)} to ${when(market.endTime)} (${result.candleCount} one-minute candles)`);
  console.log(`Strategy: causal 30m mean reversion; next-open fills; 0.10% fee per side.`);
  console.log('');
  for (const trade of result.trades) {
    console.log(`#${trade.id} BUY  ${when(trade.buyTime)} @ ${money(trade.buyPrice)} | SELL ${when(trade.sellTime)} @ ${money(trade.sellPrice)}`);
    console.log(`   ${trade.quantityBtc.toFixed(6)} BTC | fees ${money(trade.buyFeeUsd + trade.sellFeeUsd)} | ${trade.exitReason} | P/L ${money(trade.profitUsd)} (${trade.profitPercent.toFixed(2)}%)`);
  }
  console.log('');
  console.log(`Completed round trips: ${result.trades.length}`);
  console.log(`Final balance: ${money(result.finalBalanceUsd)}`);
  console.log(`Net P/L: ${money(result.profitUsd)} (${result.profitPercent.toFixed(2)}%)`);
  console.log(`Buy-and-hold: ${money(result.buyAndHoldFinalUsd)} (${money(result.buyAndHoldProfitUsd)})`);
  console.log(`Fees paid: ${money(result.totalFeesUsd)} | Ending BTC: 0.000000`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
