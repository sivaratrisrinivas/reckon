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
