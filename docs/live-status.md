# Live testnet status (rehearsal account), 15 November 2026 IST

Status: the production contract is deployed and initialized on testnet and its restricted keys are in place, but no prediction has been published. Both paid attempts to refresh the oracle reference failed, so the live round has not run. Machine-readable record: `docs/evidence/live-testnet-rehearsal-2026-11-14.json`.

Accounts: agent `reckon-srinivas-test-2026.testnet`; challenger and keeper `challenger.reckon-srinivas-test-2026.testnet`. The agent still holds its full-access key (rehearsal account, final lock not approved, nothing deleted).

## Proven on the live network

- The production Wasm (sha256 `9b52332ebd6dff8dd265592309eea57c2a3a34b11c264ddb01183673168bdc9e`, 441,968 bytes, no `set_payment_callback_fault` export, exports equal to the runbook allowlist) was deployed and `new_live` ran in the same transaction. The on-chain code hash is `BTJtgxmWTjd3aD7YUqs6oGeXgHop59FnQtwGaziTrSo7`. `life` reports 1 NEAR bankroll, 5 NEAR reserve, not dead. Storage is 442,684 bytes (4.42684 NEAR locked).
- A function-call key limited to `publish_prediction` (allowance 0.3 NEAR) is on the agent. It was refused by the network, before any contract code ran, when asked to transfer, to call `accrue`, to attach a deposit, or to target another account. Allowance did not change on those refusals.
- A separate keeper function-call key on the challenger account is limited to `request_settlement`, `void_unsettled_prediction` and `retry_payment` on the agent. It cannot transfer.
- Authorization probe: `publish_prediction` with the restricted key and decision `abstain` was accepted by the network and trapped inside the contract. The failure carries no message (see below), so this shows the key was accepted, not which check rejected the call.
- Gas pricing measured: a prepaid amount is priced upfront at 0.001 NEAR per Tgas and the unused part is refunded and credited back to the allowance. A failed publication costs 0.0001835 NEAR of allowance regardless of the prepaid amount (100 or 60 Tgas).

## On-chain ledger

| # | Action | Signer | Transaction | Cost (NEAR) |
| --- | --- | --- | --- | --- |
| 1 | Create `challenger.` subaccount, transfer 0.5 NEAR | agent | `8ZBfhmPoccBiuGV3ns3M1918AQnrtMNCRC5bUFTsKAgG` | 0.5 transferred, fee 0.0071149895 |
| 2 | Deploy production Wasm and `new_live` (1 NEAR bankroll, 5 NEAR reserve) | agent | `71tHXNjdYMTD6dHWHPiW3bEWc8X7WzqLjq6t4dF3nhT2` | fee 0.0033817694 |
| 3 | Add publication key (allowance 0.3) | agent | `3pHtQXdNG8szvk4ba5q2s4erP412Wzzi17sJvg7T2qFv` | fee 0.0000420627 |
| 4 | Add keeper key on the challenger (allowance 0.1) | challenger | `ApJ4ZouBv419CZizbYcHbFuY9qRu9xenYa71tujsPQ3M` | fee 0.0000420781 |
| 5 | Probe: publish, decision abstain, 100 Tgas | publication key | `7VoRZBPqsoonHMExeLJMwdcGoQxtQ4rGnUdqSE8iKcU` | allowance debit 0.0001835287 |
| 6 | Probe: same, 60 Tgas | publication key | `Dhp1463yrRMmKhfsQeeWe19Azy4LoGHwohWodrYNLjmY` | allowance debit 0.0001835287 |
| 7 | Probe: keeper `request_settlement`, nothing active, 30 Tgas | keeper key | `AojoxB8nz2wYVB37BtU9uPJZbyAgVo9UaG9MqiA6Zbxu` | allowance debit 0.0001775759 |
| 8 | Delete keeper key (allowance too small for a 240 Tgas settlement) | challenger | `9ZxBoRBKDasofv9oKAXmKzs9vfgDj8o7G1ywm1bjCUuY` | fee 0.0000406012 |
| 9 | Re-add the same keeper key, allowance 0.1 changed to 0.4 (function-call key only; full-access key untouched) | challenger | `5pwESdPQYWjDKHPYGxsLwPqKc8rizrnN2N6bW5Q9TNtX` | fee 0.0000420781 |
| 10 | Paid refresh attempt 1: `request_price_data`, 100 Tgas, 0.02 attached. Failed: outlayer "Exceeded the prepaid gas"; deposit not returned | challenger | `AHfAm73xHNKVVibpmLMhZKoLZ9eRg3e8N4MXXhnd8uit` | lost 0.0207364843 |
| 11 | Paid refresh attempt 2: same, 250 Tgas. Worker ran and reported `Failed`; 0.019 of 0.02 refunded | challenger | `C3PWT7AxXTszm6VoAUULyp6DMxf4mEao7zSBVkjoJfhG` | lost 0.0021589910 |

Lost to the oracle on failed refreshes: 0.022895 NEAR. Paid oracle calls used: 2 of 4. Model calls used: 0 of 6. Nothing is in flight.

Balances after the last step: agent 9.4890941210 NEAR; challenger 0.4768021913 NEAR. Restricted-key allowances: publication key about 0.29963 NEAR; keeper key 0.4 NEAR.

## Round 3 (15 November 2026, 01:05 IST; the captain approved one round)

Run from the captain's machine with `scripts/live/round.ts round round3` at commit `1eaf109` (keys never left that machine; log and evidence secret-scanned). Evidence: `docs/evidence/live-testnet-round3-2026-11-15.json`.

| # | Action | Signer | Transaction | Cost (NEAR) |
| --- | --- | --- | --- | --- |
| 12 | Paid refresh 3: `request_price_data`, 250 Tgas, 0.02 attached. Succeeded: `wrap.near` reference 3.08363333 USD | challenger | `EmvNjZmmjso8LY8au5vqLK5i7Ab2oGGMNVaDPstiiDwj` | 0.0026890591 (gas 0.0012486590, oracle fee 0.0014404001) |

Model call 1 of 6 (NEAR AI Cloud, about 3.3 s) answered with a confidence outside the contract's supported 10% to 90% fair-odds range, so the service refused to publish (`unavailable`, no transaction). The script stopped before the challenge and settlement as designed. No prediction was published, nothing is in flight, and per the one-round approval nothing was retried.

Totals after round 3: paid oracle calls 3 of 4, model calls 1 of 6, lost to the oracle in total 0.0243354 NEAR. Balances: agent 9.4890941210 NEAR (unchanged), challenger 0.4741131322 NEAR.

Finding: a live round can spend a paid refresh and then publish nothing if the model's confidence falls outside 10% to 90%. Calling the model before paying for the refresh (it needs only the candles), or prompting it within the range, would avoid that cost; neither is implemented.

## What failed and why

1. Attempt 1 was my error: 100 Tgas is too little for `request_price_data`, because `outlayer.testnet` needs more gas to start the execution. The earlier diagnostics prepaid 250 Tgas. The failed receipt sent the deposit to the oracle, not back to the caller.
2. Attempt 2 had enough gas and reached the worker, which answered plain `Failed` (`price-oracle` project, version `3585b3890f49748713b43ccb9b0ef4148f317d62f4d598db80fdaffc3f3185a0`). `wrap.near` stays `price: null`. The last successful report on chain is from 13:47:05 UTC on 14 November (price 3.34433333), so the worker worked about five hours earlier.
3. Read-only diagnosis found no cause on our side: same input as the earlier successful runs; `outlayer.testnet` is not paused and is taking other requests (counter 47539, our request was 47516). Whether other executions succeed cannot be seen without an indexer. The only untested difference is calling through `request_price_data` instead of `oracle_call`.

## Findings that need a scope decision

- Every live publication needs a paid reference refresh first, and settlement is a second paid worker call. A hosted service needs a funded refresher with a full-access key; a function-call key cannot attach the deposit.
- Contract panics arrive in receipts as `WebAssembly trap: An unreachable opcode was executed.` with no message. Interface code that matches failure text, and the runbook's expected probe message, do not work on testnet.
- `https://rpc.testnet.near.org` returns 429 with a deprecation warning under light use. `https://test.rpc.fastnear.com` worked throughout.
- The keeper key must have an allowance above the largest prepaid gas (0.24 NEAR for settlement), so a small allowance silently disables it.

## Remaining steps if the oracle recovers

1. Cost of one more refresh: about 0.0022 NEAR if the worker fails again, about 0.0035 NEAR if it succeeds (0.02 deposit, 0.0013 charged). It would be paid call 3. Settlement would be call 4.
2. Run `RECKON_TESTNET_RPC=https://test.rpc.fastnear.com RECKON_ORACLE_RPC=https://test.rpc.fastnear.com NODE_OPTIONS=--no-deprecation ./scripts/with-local-env.sh node --import tsx scripts/live/round.ts round <round-id>` from the repository root with the private `.env` linked. It refreshes the reference (250 Tgas), makes one live forecast (model call 1), publishes with the restricted key, challenges from the challenger within 30 seconds, requests settlement with the keeper key at the deadline, voids at the 120 second cutoff if needed, then checks the outcome and payout against balances. It stops before any further paid step if the refresh fails or the reference stays null. Its evidence file is written to `.local/runtime/live/round-<round-id>.json` (no secrets); review it and copy it to `docs/evidence/`.
3. Not yet verified (written but not run, queued behind the shared lock): `tests/testnet-chain.ts`, `tests/testnet-service.ts`, and a project typecheck and lint with the new files. `service.ts` dispatches `RECKON_CHAIN=testnet` to `testnet-main.ts` in a separate commit that can be dropped. The browser wallet flow has not been started.
