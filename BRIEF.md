
## The task

Write a bot that replays the last 24 hours of BTC/USD prices and trades them with your strategy, as if it had been running live. No real money: it starts with 10,000 USD of paper money. Any language, any AI tools.

## Rules

- **Profitable:** it ends the 24 hours with more than 10,000 USD, after fees.
- **At least 5 trades:** a trade is a buy and the sell that closes it.
- **Flat at the end:** it holds 0 BTC when the 24 hours end. Everything it buys, it sells inside the window.
- **Fees:** 0.1% on every buy and every sell.
- **Long only:** no leverage, no shorting.
- **No look-ahead:** each decision uses only prices up to that moment.
- **Real data:** the bot fetches prices itself from a free public feed (for example Binance or Coinbase public candles), with no API keys. Candle size is your choice.
- **Rerunnable:** one command, no edits between runs. The window is always the 24 hours before the moment it runs.
- **Time box:** 4 hours of hands-on time.

## What the bot prints

- Every trade: buy time and price, sell time and price, size, fees, profit or loss.
- Totals: number of trades, final balance, profit in USD and %, and buy-and-hold over the same 24 hours for comparison.
