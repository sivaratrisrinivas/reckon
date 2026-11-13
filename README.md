# Reckon

Reckon is an experiment in an AI staking its own bankroll on its predictions. The local browser can request one forecast, inspect its fixed terms, and download the evidence snapshot committed by fingerprint to the real NEAR sandbox contract. The current slice does not accept stakes or settle predictions. All funds in this demonstration are sandbox test money; this is not a testnet or mainnet deployment.

## Run on Linux x86-64

The verified versions are Rust 1.95.0 with `wasm32-unknown-unknown`, Node 26.13.0 and npm 12.2.2, NEAR SDK 5.30.1, and NEAR sandbox 2.14.0. Install Rust using [rustup](https://rustup.rs/) and Node using your preferred version manager. The `rust-toolchain.toml` selects Rust and its Wasm target. The sandbox installation script downloads the NEAR binary and verifies its SHA-256 hash.

```sh
npm ci --ignore-scripts
./scripts/install-sandbox.sh
export NEAR_SANDBOX_BIN_PATH=1
export NEAR_SANDBOX_BINARY_PATH="$PWD/.local/sandbox"
npm run build:contract
npm start
```

Open http://127.0.0.1:4389. The service starts a new sandbox and initializes a fresh agent each time it runs. Watch spendable bankroll decrease and retired bankroll increase as blocks advance, or press **Ask Reckon** to request one forecast. No wallet is needed. Stop with Ctrl-C. Set `PORT` to change the browser port. This is a local development tool: the sandbox dependency binds its RPC and network ports to all interfaces, so run it only on a trusted machine and network.

## Forecasts and evidence

`RECKON_PROVIDER_MODE` defaults to `fixture`. In this mode, recent simulated NEAR/USD candles, a simulated oracle reference, and a deterministic model response are labelled in the browser and evidence file. They exercise the same compiled contract and restricted prediction key as a real request; they do not demonstrate live forecast skill. This local-only fixture is never selected as a fallback in live provider mode.

Set `RECKON_PROVIDER_MODE=live` to use completed public Coinbase NEAR-USD candles, the cached `wrap.near` reference from `price-oracle.testnet`, and the configured NEAR AI model. Live mode requires `NEAR_AI_API_KEY` and `NEAR_AI_MODEL` in the private `.env`; without both, the service exits instead of substituting a fixture. The oracle reference may be null or stale. In that case, or if market evidence or inference is unavailable, no prediction is published. This mode still publishes only to the local sandbox contract. It does not refresh the oracle for a new on-chain observation, deploy to testnet, or accept a wager.

The model sees the fixed binary question, the reference price, recent completed candles, and the bounded settlement rules. It returns `yes`, `no`, or `abstain`, a probability for its selected side, and a short justification. Invalid output, abstention, unsupported confidence, or stale prerequisites create no prediction. The current input checks require completed candles to be at most 180 seconds old and the oracle response plus its reported recency allowance to fit within 600 seconds. These are implementation limits, not measured production freshness guarantees. The contract fixes deadlines at publication: a thirty-second challenge window and a five-minute prediction horizon. Equality is no. The one unresolved prediction is enforced on-chain.

The contract stores confidence as parts per million on a 1,000,000 scale. The current quote supports confidence from 100,000 to 900,000 (10% to 90%) and rounds to the nearest one millionth. For selected-side confidence `q`, the fair challenger stake is `agent stake × (1 − q) / q`, rounded to the nearest yoctoNEAR, ties upward. The agent stake uses at most 2% of spendable bankroll projected after the thirty-second challenge window. Monetary amounts are checked `u128` yoctoNEAR integers; the agent stake minimum is 0.01 NEAR and the challenger stake minimum is 0.001 NEAR. The reference multiplier must be positive, fit `u128`, and use between 0 and 24 decimals. These are initial implementation settings for the local slice; they require measured rehearsal and confirmation before any final testnet configuration.

The local contract is initialized with a generated prediction public key and a finite 5 NEAR function-call allowance restricted to `publish_prediction`. The contract checks that exact key when it publishes. This allowance is only a local development setting; production lifetime and reserves have not been measured.

Each published snapshot is canonical JSON written once under `.local/evidence/<sha256>.json`, before the contract stores its fingerprint. The local service serves it without a wallet and checks the hash before download. This filesystem storage survives a service restart on the same machine, but it is not durable public hosting. The fingerprint detects later byte changes; it does not prove inference execution, source truth, or continued availability. The snapshot records provider identities and times, model identity and structured response, prompt version, and the short justification.

In live provider mode, a filesystem cooldown limits requests to one every thirty seconds and the persisted model-call budget allows at most twelve attempts per UTC day on that machine. These controls are bounded local safeguards, not a shared production rate limiter.

The local agent begins with 100 NEAR spendable and a separate 20 NEAR operational reserve. Its initial idle life is accelerated to 15 minutes. The contract’s `new_live` initializer fixes the live idle rate at fifteen days; it has not been deployed to testnet. Upkeep is a configured rule, not an invoice, and retired funds remain on the account but cannot be used for new stakes. The reserve covers operational and storage needs; it is not agent bankroll. Direct transfers do not increase usable bankroll. A life view projects costs through the latest chain block, so it advances with sandbox blocks, not a separate browser clock.

The [integration diagnostic](http://127.0.0.1:4389/diagnostic) displays recorded testnet oracle and model observations. It does not run a new live probe or enable wagering. The scratch contract in `diagnostic-contract/` exists only to inspect the testnet oracle callback; it is not suitable for custody or production settlement. Its paid testnet transaction and limitations are recorded in `docs/research/price-settlement-feasibility.md`. The observed model responses and limits are recorded in `docs/research/market-data-and-model-feasibility.md`.

To run a new diagnostic, first deploy the scratch contract to a dedicated, funded testnet account and initialize it with `reset`; do not use an account holding real money. The runner needs `NEAR_ACCOUNT_ID`, `NEAR_AI_API_KEY` and `NEAR_AI_MODEL` in a private `.env`, the account's signing key in the NEAR CLI legacy keychain, and NEAR CLI installed at `.local/near-cli/node_modules/.bin/near`. With Node 26 on `PATH`, run `node --import tsx diagnostic/live-probe.ts`. The runner checks the deployed code against the locally built scratch Wasm before signing. Each run may spend testnet NEAR and model credits. It writes a private JSON result under `.local/diagnostic-runs/`; the diagnostic page displays the latest result after a refresh. The runner does not deploy or reset contracts, publish predictions, or accept wagers. The oracle report time does not verify the external market observation time. A timeout may leave costs or transaction completion unknown; check the testnet account before retrying. If a run is forcibly interrupted, check for a pending transaction before removing a leftover `.local/diagnostic-runs/probe.lock`.

Keep API keys and private keys out of chat, screenshots, terminal output and commits. Enter secrets locally using hidden input and keep `.env` private; it is ignored by Git. For example, to add or replace the NEAR AI key without echoing it or putting it in shell history:

```sh
python3 -c 'import getpass,pathlib; p=pathlib.Path(".env"); k=getpass.getpass("NEAR AI API key: "); s=[line for line in (p.read_text().splitlines() if p.exists() else []) if not line.startswith("NEAR_AI_API_KEY=")]; p.write_text("\n".join(s+["NEAR_AI_API_KEY="+repr(k)])+"\n"); p.chmod(0o600)'
```

If an API key is exposed, revoke it with its provider and replace it in `.env`. If a testnet private key is exposed, stop using that account and create a new disposable account; remove the exposed access key if the account must be retained. Avoid sharing screenshots that show credentials.

For the disposable account used in the recorded rehearsal, the following commands rebuild, deploy and reset the scratch contract. **Reset deletes the scratch contract's stored callback; never use these commands on an account holding another contract or real funds.** The NEAR CLI is version 0.31.1; the following installs it locally and runs its installer explicitly because npm may block package install scripts:

```sh
npm install --prefix .local/near-cli near-cli-rs@0.31.1
node .local/near-cli/node_modules/near-cli-rs/install.js
export PATH="$PWD/.local/near-cli/node_modules/.bin:$PATH"
npm run build:diagnostic
near contract deploy reckon-srinivas-probe-2026.testnet use-file diagnostic-contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm without-init-call network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction reckon-srinivas-probe-2026.testnet reset json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as reckon-srinivas-probe-2026.testnet network-config testnet sign-with-legacy-keychain send
```

For another account, replace both occurrences of the account name and use only a disposable testnet account with its own signing key. The local lock prevents concurrent runs on one machine. The scratch contract also rejects another request while one is pending and permits replacement after 120 seconds. A delayed earlier callback is rejected after replacement, and callbacks after 120 seconds are rejected. The runner measures its separate timeout locally from submission, while the contract uses block time from request execution. Network delays and differences between those clocks can therefore make the runner report unavailable while the contract would still accept a callback, or leave the runner waiting for a callback the contract has rejected. Check the account before retrying; these diagnostic timeouts are not a production settlement deadline. Reset clears the scratch callback and pending request but preserves the request generation to reject older callbacks. Local evidence files are retained until you choose to remove them.

To rebuild the scratch contract and test unauthorized calls, matching callbacks, replays and expired callbacks on the local sandbox, run `npm run test:diagnostic-contract` with the sandbox environment variables configured above. These checks use a local oracle fixture; a positive callback was also exercised against the real testnet oracle in the recorded transaction. The runner verifies both the deployed Wasm and `price-oracle.testnet` configuration before spending.

## Verify

After the build above, install Chromium and its Linux system dependencies, then run the checks. The `--with-deps` step may require administrator privileges:

```sh
npx playwright install --with-deps chromium --only-shell
rustup component add rustfmt
npm run lint
npm run typecheck
npm test
npm run test:diagnostic-contract
npm run audit:high
```

The start and test commands check for the configured sandbox 2.14.0 binary and the compiled contract before running. If either is missing, follow the setup commands above. The contract checks deploy to a real sandbox, reject initialization twice, transfer funds, advance sandbox time, and exercise repeated upkeep, death, and the fifteen-day live rate. The browser test starts its own sandbox, advances its time through a test-only endpoint, and checks the displayed funds and life. Test processes need permission to bind local ports. They require no paid inference or personal keys.

If sandbox tests stall or fail, first check the configured sandbox variables and binary, then check free temporary space with `df -h /tmp` and look for leftover processes with `ps -ef | grep '[n]ear-sandbox'`. Stop only sandbox processes you know are no longer needed and remove only their obsolete temporary data. An expired block-hash message can be followed by a retry that takes time; check whether the test completes before interrupting it. If a browser test reports its port is in use, stop the other test server or run the tests after it finishes.

## Dependencies and assistance

The contract uses NEAR SDK and `uint`; the local service and verification use NEAR Workspaces, `near-api-js`, TypeScript, tsx and Playwright. Exact versions are recorded in the lockfiles. The sandbox tooling overrides its `tar` dependency to a patched version; run `npm run audit:high` to check for high and critical advisories, or `npm audit` to see all severities. The latest audit still reports low and moderate findings. This tooling is for local development only, not a hosted service. npm 12 blocks dependency install scripts by default; the explicit sandbox installer above avoids relying on the older binary that dependency would otherwise install.

This initial implementation was developed with AI assistance. It has not been deployed or audited for real-money use.
