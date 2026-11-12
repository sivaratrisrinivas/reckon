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

## Authenticated model attempt: 12 November 2026 UTC

Using a Builders credit key, an authenticated structured-output request was made to `Qwen/Qwen3.8-27B`, with completed Coinbase candles, the testnet oracle callback reference, and the binary question and settlement rules. The returned model identity matched. After 65.187 seconds the model exhausted the 512-token output budget on reasoning, returning null content and `finish_reason: length`. This is unavailable inference, not a prediction or a verified abstention. The first attempt's inputs and response metadata are preserved in `docs/evidence/model-attempt-1.json`; reasoning text is omitted. No credential is recorded.

Usage reported 905 prompt tokens and 512 completion tokens. At the catalog rates observed for that model ($0.04 per million input tokens and $1.35 per million output tokens), the calculated cost is approximately $0.0007274; this is an estimate, not a verified billing charge. Actual structured output, abstention, costs under a successful request, and an acceptable timeout remain unproven.

A second request with a 2048-token output limit timed out after 90 seconds without a response. Its eventual completion and cost are unknown. No response from that attempt was accepted. Further model configuration or selection needs a successful measured structured response before inference can be used.

After rejecting the stale reference and paying for another refresh, a third call used `Qwen/Qwen3-VL-30B-A3B-Instruct`. It returned a structured `no` response with confidence 0.85 in 1.953 seconds. The oracle reference was 3.40546666 USD and the latest completed Coinbase candle closed at 3.3994 USD, a difference of 0.00606666 USD. The provider identities and observation and fetch times are preserved in `docs/evidence/model-attempt-instruct.json`. The catalog rates of $0.15 per million input tokens and $0.55 per million output tokens yield an estimated $0.00021345 for the reported 851 input and 156 output tokens; this is not a verified charge.

For an explicitly synthetic missing-data test, the same model returned `abstain` in 1.407 seconds but set confidence to 0 instead of the requested null. This is invalid under the diagnostic's semantic rules and must be rejected. One successful output is not evidence of reliable structured output or calibrated confidence; the schema needs validation and a tested abstention path before use. The synthetic request reported 93 input and 67 output tokens.

When a separate synthetic missing-data request constrained the schema itself to `decision: abstain` and null confidence, the same model returned that shape in 1.402 seconds, using 93 input and 79 output tokens. Because the schema forced that choice, this demonstrates format compliance under the constraint, not that the model can independently choose a valid abstention alongside yes and no.

The NEAR Builders dashboard displayed "usage unavailable" for the claimed credit key when checked on 13 November 2026 (IST). The individual provider charges therefore remain unverified; the token-price calculations above are estimates, and the timed-out request may also have incurred a charge.

## Independent abstention and latency samples: 13 November 2026 IST

An authenticated `Qwen/Qwen3-VL-30B-A3B-Instruct` request used a reworded version of the binary question and settlement rules with explicitly synthetic missing candles and reference. The JSON schema offered all three choices (`yes`, `no`, and `abstain`) and permitted a number or null for confidence. The recorded response chose `abstain` with null confidence and a nonempty justification; the diagnostic validator accepted it. It returned in 1.659 seconds, with 161 input and 103 output tokens. This is one recorded abstention under deliberately missing inputs, not a reliability or calibration measurement. The request, structured response, usage and timing are recorded in `docs/evidence/model-abstention.json`; the snapshot does not independently prove the provider executed the request.

Three subsequent sequential live probes returned structured responses that the runner validated in 1.876, 1.636 and 1.694 seconds respectively. The saved summary does not contain those response bodies. They used 882, 884 and 943 prompt tokens and 156, 110 and 128 completion tokens. The provider reported 64 cached prompt tokens in each. At the catalog prices observed during the check ($0.15 per million uncached input tokens, $0.03 per million cached input tokens, $0.55 per million output tokens), their estimated costs are $0.00021042, $0.00018542 and $0.00020417; the abstention estimate is $0.0000808, assuming no cached input tokens because none were reported. These calculations assume the reported cached-token pricing applies; they are not actual billing records. The dashboard still reports usage unavailable, and the prior timed-out request may also have been charged.

These four calls are too few to establish a tail latency, provider availability or a production timeout. The diagnostic's timeout is an experiment limit, not a measured settlement-window setting. Sample metadata is recorded in `docs/evidence/testnet-latency-cost-samples.json`.
