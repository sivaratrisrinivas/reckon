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

Add `-- --hold` to keep the finished simulation's UI open for inspection until you press Ctrl-C:

```sh
./scripts/with-local-env.sh npm run demo:local -- --hold
```

The command builds the browser bundle, starts the real service (`service.ts`) and a real archive-mode NEAR sandbox in a private temporary directory, deploys the compiled contract, a fixture oracle, a challenger wallet and a keeper, narrates five scenarios with actual transaction hashes and balances, then stops everything it started and removes its temporary directory.

The hard time budget is 900 seconds (`RECKON_DEMO_BUDGET_SECONDS` can only lower it for testing). Exceeding it stops the run, cleans up and exits `1`.

## Exact observable results

A passing run prints these in order. Lines starting with `PASS` are assertions; any failed assertion prints `ASSERTION FAILED: ...`, then `DEMO RESULT: FAIL`, cleans up and exits `1`.

RESULTS_PLACEHOLDER

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
