# Local simulation: a complete life ending in verified death

`npm run demo:local` runs one clearly labelled, credential-free simulation of Reckon's whole life on your machine and exits `0` only if every assertion about money, permissions and death holds. It needs no personal key, no live account, no paid inference and no network once the prerequisites are installed.

## What it is, and what it is not

Everything in this run is simulated, and the command says so in its narration, in the local UI and in the evidence snapshots it publishes:

- **Simulated prices.** A scripted NEAR/USD market and a deterministic oracle fixture contract replace live market data and the paid testnet oracle.
- **Scripted forecasts.** A deterministic model fixture always answers NO at 85% confidence. No inference runs.
- **Accelerated timing.** The sandbox clock is fast-forwarded through the five-minute prediction horizon and the 120-second settlement window. Upkeep spends the 100 NEAR bankroll in 2,400 simulated seconds instead of fifteen days.
- **Play money.** All funds are sandbox NEAR on a disposable local chain, not testnet or mainnet.

This verifies the lifecycle, payments, permissions and death of the real compiled contract. It does **not** demonstrate live forecasting skill, paid oracle refresh, wallet integration or testnet behaviour. Those need the separate live rehearsal.

What is real: the Rust agent contract compiled from this repository, the TypeScript service and its keeper, a real NEAR sandbox (nearcore 2.14.0) with real receipts and balances, real access keys, and the browser bundle built from `public/`. What is simulated: the market data, the model, the oracle response, the clock speed and the money.

## Prerequisites

Linux x86-64 (or WSL) with about 4 GB of free memory and permission to bind loopback ports. Follow the install steps in the [README](../README.md) once:

```sh
./scripts/install-node.sh                         # Node 26.13.0, hash-verified
./scripts/with-local-env.sh npm ci --ignore-scripts
./scripts/install-sandbox.sh                      # NEAR sandbox 2.14.0, hash-verified
./scripts/with-local-env.sh npm run build:contract
```

Rust 1.95.0 with the `wasm32-unknown-unknown` target (selected by `rust-toolchain.toml`) is needed for `build:contract`. Chromium is **not** needed to run the demo; it is needed only for the browser test suite.

No `.env` file, API key, Vercel token or testnet account is needed, read or passed on. The command refuses to start if `RECKON_PROVIDER_MODE=live` is set in your environment, and it gives the service a whitelisted environment so credentials in your shell cannot reach it.

## Run it

```sh
./scripts/with-local-env.sh npm run demo:local
```

Add `-- --hold` to keep the finished simulation's UI open for inspection until you press Ctrl-C (the run prints `HOLDING` after its result, and Ctrl-C then stops the service and removes the temporary directory):

```sh
./scripts/with-local-env.sh npm run demo:local -- --hold
```

The command builds the browser bundle, starts the real service (`service.ts`) and a real archive-mode NEAR sandbox in a private temporary directory, deploys the compiled contract, a fixture oracle, a challenger wallet and a keeper, narrates five scenarios with actual transaction hashes and balances, then stops everything it started and removes its temporary directory.

The hard time budget is 600 seconds (`RECKON_DEMO_BUDGET_SECONDS` can only lower it for testing). Exceeding it stops the run, cleans up and exits `1`.

## Exact observable results

A passing run prints these in order. Lines starting with `PASS` are assertions; any failed assertion prints `ASSERTION FAILED: ...`, then `DEMO RESULT: FAIL`, cleans up and exits `1`.

The run takes about three to four minutes of wall time on an ordinary machine (the measured run was 190 seconds). Each section below starts with a `== heading  (t+Ns)` line.

1. **Banner.** Lines naming `SIMULATED PRICES`, `SCRIPTED FORECASTS`, `ACCELERATED TIMING` and `PLAY MONEY`, the sentence `This run ... does NOT demonstrate live forecasting skill`, the 600-second hard budget and the private work directory (`.../rkd-XXXXXX`).
2. **Preflight and build.** `PASS` for the sandbox and fresh contract artifacts, and for the browser bundle. A missing prerequisite prints the original `check-local.sh` message and the run fails before starting anything.
3. **Starting the real service.** `Local UI: http://127.0.0.1:<port>`; open it while the run is in progress to watch the same chain. The UI header shows `FORECAST INPUTS · SCRIPTED LOCAL FIXTURES · SIMULATED PRICES · ACCELERATED TIMING · NOT LIVE FORECASTING SKILL` and `LOCAL SANDBOX · TEST MONEY`.
4. **Simulation disclosures.** Ten `PASS` lines: fixture provider mode, test-money network, labelled evidence storage, the four disclosure strings in the served UI bundle, the page labels, and the deterministic challenger key.
5. **Baseline.** The deployed contract exports exactly the repository production Wasm's 20 functions, does not export `set_payment_callback_fault` (which the test-only build adds), and exports no withdrawal, upgrade, owner, administrative or key-management method. The account starts with one full-access key and one function-call key limited to `publish_prediction` on the agent account with a finite 5 NEAR allowance. The first conservation check shows held funds (about 120 NEAR) against obligations (100 NEAR) plus the 20 NEAR reserve.
6. **Restricted-key rehearsal.** The prediction key is rejected by the chain with `RequiresFullAccess` for a transfer, a code deployment, adding a key and deleting a key, with `MethodNameMismatch` for any other method and with `ReceiverMismatch` for any other account. The full-access key and an unrelated account are each rejected by the contract when they try to publish. The production Wasm has no fault method (`MethodNotFound`).
7. **Scenario 1, agent win.** The real service publishes prediction #1 (scripted NO at 85%, signed by the restricted key, evidence hash matching the download). The challenger wallet takes the position through the service's RPC proxy. After 300 simulated seconds the keeper settles with the simulated price below the reference: outcome NO, no payment, the contract account balance unchanged, the challenger balance unchanged.
8. **Scenario 2, challenger win.** Simulated price above the reference: outcome YES. The challenger account balance rises by exactly both stakes and the contract balance falls by exactly the same amount; a bystander account receives nothing; the payout receipt on the challenger account is printed.
9. **Scenario 3, void refund.** The simulated oracle never answers. A void attempt before the 120-second window closes is rejected. After the window the keeper voids: the challenger receives exactly its original stake, the contract pays that stake plus the 0.02 NEAR simulated oracle fee (charged to the reserve), the commitment is released and the round is excluded from accuracy.
10. **Scenario 4, recoverable payment failure.** The winning challenger's account is deleted before settlement, so the payout transfer fails. The result stands, the amount stays a pending liability to the same beneficiary, the funds are back in the contract and conservation still holds with the liability counted. The keeper's retries are rejected while the account is absent.
11. **Scenario 5, permanent death.** The run skips idle time to leave about 100 simulated seconds of life, then the service publishes and a taker accepts the last challenge. Upkeep exhausts the bankroll mid-round. The late correct forecast resolves, both late stakes are retired rather than returned to usable bankroll, spendable bankroll stays zero, and the earlier payment liability is still outstanding.
12. **Death is irreversible.** The service cannot publish; the restricted key still signs but the contract rejects it; takes (with 1 NEAR attached) are rejected and refunded; an unsolicited 1 NEAR transfer does not revive the agent; conservation holds with that transfer counted as unsolicited.
13. **Lock rehearsal.** The full-access key removes itself on the throwaway account. Exactly one key remains (the restricted key). The old key is rejected with `AccessKeyNotFound` for a transfer, a deployment and adding a key, and keys, code and funds are unchanged.
14. **Recovery after death and the lock.** The challenger account is restored, the service's retry (the same path as the UI's **Retry payment** button) pays the original beneficiary the original amount exactly once, a third party's duplicate retry is rejected, and the final conservation check shows no pending liability.
15. **Summary and result.** Five scenario lines (`1. agent win` through `5. permanent death`), then `ASSERTIONS PASSED: <count>` and `DEMO RESULT: PASS in <N>s of the 600s hard budget`.
16. **Cleanup.** Three `OK` lines: no process started by this run is still running, the service port is closed, and the temporary directory is removed. The exit code is `0`.

Failure modes, all non-zero: a failed assertion (every `FAIL` line is repeated under `Failed assertions:`), a startup or prerequisite failure, the time budget, `RECKON_PROVIDER_MODE=live` in the environment, and cleanup that cannot remove what the run started. Assertions never stop the run early, so one run lists every failure.

## Why the assertions are not just narration

Each balance claim compares recorded obligations with actual NEAR balances read from the sandbox. The recorded obligations are the contract's public `life` view: spendable bankroll, commitments, challenger custody, retired bankroll and pending payment liabilities. The actual funds are the contract account's balance from the node, minus its storage stake. The command asserts:

- the account never holds more than recorded obligations plus the operational reserve plus funds someone sent unsolicited;
- every recorded obligation, including pending liabilities, is backed by available funds, so gas, storage and oracle fees draw down only the operational reserve;
- exact balance deltas for each stake, payout and refund, taken from the `view_account` RPC rather than the service's own reporting.

## Restricted-key rehearsal and the lock

The sandbox contract account starts with a deterministic full-access key and a function-call key limited to `publish_prediction` with a finite 5 NEAR gas allowance. Before any lock the command shows that the restricted key cannot transfer, deploy code, add or delete keys, call another method or call another account. It also shows the contract itself rejects publication by the full-access key and by any other account.

After death it removes the full-access key from the throwaway sandbox account, shows that exactly one restricted key remains, and shows that the old full-access key can no longer transfer, deploy or add keys. The failed attempts change no keys, code or funds.

This is a **rehearsal on a disposable sandbox account**. It is not the live lock. Removing the full-access key of the real testnet account is irreversible, and it remains a separate, human-approved action that this command never performs or simulates as real. Do not run the final lock until the rehearsal here and the live rehearsal agree.

## Test-only controls and deterministic signers

To make a bounded, reproducible run the command uses the service's `RECKON_TEST=1` loopback endpoints: fast-forward the sandbox clock, select the fixture oracle's response, and delete and restore the challenger account to force a payment failure. Each is a labelled simulation control, not a product feature. With `RECKON_DEMO_LOCAL=1` the service deploys the production Wasm, not the separate test-only callback-fault build.

The signers are derived from fixed public labels (`local-signers.ts`), so a run uses the same keys every time. They are play-money sandbox keys that anyone can derive. Never use them anywhere that holds value.

## Verify bounded completion and cleanup

Run the command twice in a row. Each run must exit `0` inside its budget and print the three `OK` cleanup lines. Then confirm nothing is left behind:

```sh
ps -ef | grep '[n]ear-sandbox'     # prints nothing from this run
ls "${TMPDIR:-/tmp}" | grep '^rkd-'   # prints nothing
```

Only the private `rkd-*` directory the run created is removed. Unrelated processes, your `.local` evidence and your `.env` are never touched. The browser bundle at `.local/browser/app.js` is a normal build output and stays.

## Limits

- The fixture oracle answers immediately, so this does not measure paid oracle latency or cost.
- Gas for the keeper account's own transactions (settlement requests and retries) is paid by a separate keeper account and is not part of the contract's reserve.
- The simulated oracle fee kept by the stalled-oracle fixture is real sandbox money leaving the contract and is counted against the operational reserve.
- Live Vercel Blob storage, NEAR AI inference, the wallet and the public testnet oracle are not exercised.
- With this contract build and sandbox 2.14.0, a contract-level rejection (a `require!` failure) reaches the caller as a generic `WebAssembly trap: An unreachable opcode was executed`, without the contract's message. The command still asserts that each of those six calls fails and changes no state. When the node does return the message the command asserts it; otherwise each `PASS` line says so and names the control that proves the condition, not the call, is what is refused (for example, the same key publishes while the agent is alive). This also means a user interface cannot show the contract's own reason for a rejected take from the transaction result alone.
- `RECKON_DEMO_BUDGET_SECONDS` can shorten the 600-second budget but never extend it. The measured run takes about three to four minutes.
