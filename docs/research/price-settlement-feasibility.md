# Price settlement: read-only findings

Investigated during the Reckon design interview on 13 November 2026, IST. No refresh transactions were sent. This is evidence for a design decision, not confirmation that paid refresh or live settlement works.

## Live testnet evidence

Read-only finality-final RPC queries against `price-oracle.testnet` found a deployed contract. At block 277410634, `get_price_data` for `wrap.near` returned:

```json
{
  "timestamp": "1794514291308403743",
  "recency_duration_sec": 300,
  "prices": [{"asset_id": "wrap.near", "price": null}]
}
```

At block 277410657, `get_asset` for `wrap.near` returned an underlying report timestamp of `1794410655501742367`, corresponding to 11 November 2026 at 15:24:15 UTC. Its multiplier was `370020000` and decimals were `8`. The report was older than the freshness window when queried. These observations establish a stale cache at the time of the checks, not permanent feed failure.

## Source inspection

The [public oracle implementation](https://github.com/out-layer/oracle-example/blob/main/contract/src/lib.rs) behaves consistently with the live API. Exact deployed bytecode/source identity has not been proved.

- `get_price_data` returns null for stale reports. Its outer timestamp is the executing block's timestamp, not proof of when an external market price was observed.
- `request_price_data` accepts asset IDs and resource limits. The repository documents a paid on-demand refresh.
- `oracle_call` supports delivering price data to another contract through a callback. With stale data it initiates an external fetch.
- The inspected refresh path records reports using contract execution time. The external result type has an optional fetch timestamp, but the inspected update path does not preserve it in the report.
- The inspected APIs have no historical observation-time parameter or signed historical-price input.

References: [cached reads](https://github.com/out-layer/oracle-example/blob/main/contract/src/lib.rs#L2968-L3048), [oracle_call](https://github.com/out-layer/oracle-example/blob/main/contract/src/lib.rs#L3231-L3356), [refresh request](https://github.com/out-layer/oracle-example/blob/main/contract/src/lib.rs#L3358-L3448), [report timestamp assignment](https://github.com/out-layer/oracle-example/blob/main/contract/src/lib.rs#L1172-L1212).

## Design consequence

Do not describe the returned price as a historical price at an exact expiry. A bounded settlement-time observation rule can be stated honestly, but caller timing and source caching remain relevant. Fixed-expiry semantics require a different verified data path. Paid refresh feasibility, funding, response validation, failure recovery, and callback timing remain untested.

## Follow-up observation: 13 November 2026, IST

A finality-final `get_price_data` query at testnet block 277420553 again returned `price: null` for `wrap.near`, with `recency_duration_sec: 300`. The response's outer timestamp was `1794520104391775884` ns; it is the executing block time, not an external market observation time. This response is unavailable as a reference and must not be passed to a model or used for settlement. It does not establish whether a paid refresh succeeds.

The execution environment had no configured NEAR AI credential or funded testnet account credential. Consequently no authenticated inference, paid refresh, callback, receipt cost, latency, or settlement-window and reserve measurements were obtained. These remain prerequisites for issue #3, not evidence that the approved price or trust model is infeasible. Re-run on a replaceable funded account and record actual receipts and provider timing before choosing those parameters.

## Paid callback rehearsal: 12 November 2026 UTC

A scratch contract built with NEAR SDK 5.30.1 was deployed to `reckon-srinivas-probe-2026.testnet`. Its deployment transaction was `6ViCXgbJTb1bzrcgxh226x9LiqxBK58r3QvHXrzFFRXh`; the CLI reported 15.4 Tgas and 0.0015145741592109 NEAR in transaction fees. The scratch account is replaceable and retains full-access authority; it is not the final agent.

The stale `wrap.near` cache was refreshed through `oracle_call` in transaction `2zgP6WtMJn1zcEpVicoyxuj15P6SVoxRTZwvGFHVwwzR`, with 0.02 testnet NEAR attached. OutLayer reported a charge of 0.0013698001 NEAR and a refund of 0.0186301999 NEAR; the CLI reported 17.5 Tgas and a transaction fee of 0.0015862170105164 NEAR. These are the worker charge and the CLI-reported transaction fee, not a complete reserve estimate. The worker's execution event followed its request event by approximately 8.03 seconds; its reported execution time was 3.698 seconds. One run cannot establish a reliable settlement window.

The receiving contract recorded a callback from `price-oracle.testnet` with asset `wrap.near`, multiplier `340823333`, decimals `8`, and recency duration 300 seconds. This represents 3.40823333 USD. Its report timestamp was `1794523540959669395` ns and the callback block timestamp was `1794523541444725533` ns. Neither establishes an external market observation time. The callback validates the caller, sender and message, but this scratch contract does not implement settlement, timeout recovery, replay protection, or validation of the returned price. It is evidence of the integration path only; it must not be used for custody.

A second refresh, transaction `71XnZ2ZiYkMQSwKi4R2SUHzjntXFqR9Ft3ZaYpv1rwMY`, reported 17.5 Tgas and a 0.0015889044200544 NEAR transaction fee. OutLayer reported a 0.0013365001 NEAR charge and 0.0186634999 NEAR refund, with approximately 8.14 seconds between request and completion events and 3.365 seconds of reported execution time. The callback returned 3.40546666 USD; its report and callback block timestamps are recorded with the subsequent model evidence. These two runs do not establish tail latency, recovery costs, storage headroom, or a defensible final reserve.
