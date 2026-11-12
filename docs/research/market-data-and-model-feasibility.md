# Market data and model: read-only feasibility

Investigated during the Reckon design interview on 13 November 2026, IST. No credentials were read, no inference calls were made, and no accounts or chain state were changed.

## Public price history

The official [Coinbase public product candles API](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product-candles) supports minute OHLCV candles with a product ID and UNIX start/end times. An unauthenticated request succeeded:

```text
https://api.coinbase.com/api/v3/brokerage/market/products/NEAR-USD/candles?start=1794515284&end=1794515464&granularity=ONE_MINUTE&limit=5
```

At 12 November 2026, 20:31:04 UTC, it returned HTTP 200 with NEAR-USD candle start times 1794515400 and 1794515340. The latest candle was recent but could still be incomplete. Use completed candles and explicitly validate their times rather than treating the latest returned row as closed or fresh by default. The response had a public cache-control max-age of 14400 seconds; capture fetch times and source candle times and reject stale evidence.

Coinbase is a candidate evidence provider, not the settlement authority. Its exchange prices can differ from the on-chain oracle. Record the evidence provider separately from the settlement provider and preserve the actual reference price supplied to the model.

## Model endpoint

The official [OpenAI compatibility guide](https://docs.near.ai/cloud/guides/openai-compatibility) documents base URL `https://cloud-api.near.ai/v1`, chat completions, model listing, and structured outputs. The [model catalog documentation](https://docs.near.ai/cloud/models) describes feature flags per model.

Unauthenticated GET requests to `/v1/models` and `/v1/model/list` succeeded. The first returned 64 models during the check, including models advertising structured-output support. Example model IDs in prose documentation may differ from the current catalog, so validate a configured model against the live catalog instead of copying a sample ID blindly.

Actual authenticated inference, cost, latency, credit-provider compatibility, and response-format behavior remain untested. Select and record the actual model and prompt configuration when those checks run. No claim of private or attested inference is part of the agreed product.

## Follow-up observation: 13 November 2026, IST

At 2026-11-12 21:48:22 UTC, the public Coinbase NEAR-USD one-minute candle endpoint returned ten rows. The latest completed candle began at 21:47:00 UTC and closed at 3.4301 USD; the 21:48 candle was still in progress and is not a completed observation. The response again advertised `Cache-Control: public, max-age=14400`; validate source times on every request. The testnet oracle returned a null reference at the same time, so no price difference or valid forecast input can be established from this check.

No model call was made: the execution environment did not have a configured NEAR AI API key. The measured candle is a point-in-time diagnostic, not a fallback settlement price or a prediction.
