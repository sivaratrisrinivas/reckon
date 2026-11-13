# Reckon

Reckon is an experiment in an AI staking its own bankroll on its predictions. This initial local slice shows the agent's remaining life and funds on a real NEAR sandbox. It does not yet make forecasts or accept stakes. All funds in this demonstration are sandbox test money; this is not a testnet or mainnet deployment.

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

Open http://127.0.0.1:4389. The service starts a new sandbox and initializes a fresh agent each time it runs. Watch spendable bankroll decrease and retired bankroll increase as blocks advance; no wallet or key is needed. Stop with Ctrl-C. Set `PORT` to change the browser port. This is a local development tool: the sandbox dependency binds its RPC and network ports to all interfaces, so run it only on a trusted machine and network.

The local agent begins with 100 NEAR spendable and a separate 20 NEAR operational reserve. Its initial idle life is accelerated to 15 minutes. The contract’s `new_live` initializer fixes the live idle rate at fifteen days; it has not been deployed to testnet. Upkeep is a configured rule, not an invoice, and retired funds remain on the account but cannot be used for new stakes. The reserve covers operational and storage needs; it is not agent bankroll. Direct transfers do not increase usable bankroll. A life view projects costs through the latest chain block, so it advances with sandbox blocks, not a separate browser clock.

The [integration diagnostic](http://127.0.0.1:4389/diagnostic) displays recorded testnet oracle and model observations. It does not run a new live probe or enable wagering. The scratch contract in `diagnostic-contract/` exists only to inspect the testnet oracle callback; it is not suitable for custody or production settlement. Its paid testnet transaction and limitations are recorded in `docs/research/price-settlement-feasibility.md`. The observed model responses and limits are recorded in `docs/research/market-data-and-model-feasibility.md`.

To run a new diagnostic, first deploy the scratch contract to a dedicated, funded testnet account and initialize it with `reset`; do not use an account holding real money. The runner needs `NEAR_ACCOUNT_ID`, `NEAR_AI_API_KEY` and `NEAR_AI_MODEL` in a private `.env`, the account's signing key in the NEAR CLI legacy keychain, and NEAR CLI installed at `.local/near-cli/node_modules/.bin/near`. With Node 26 on `PATH`, run `node --import tsx diagnostic/live-probe.ts`. The runner checks the deployed code against the locally built scratch Wasm before signing. Each run may spend testnet NEAR and model credits. It writes a private JSON result under `.local/diagnostic-runs/`; the diagnostic page displays the latest result after a refresh. The runner does not deploy or reset contracts, publish predictions, or accept wagers. The oracle report time does not verify the external market observation time. A timeout may leave costs or transaction completion unknown; check the testnet account before retrying. If a run is forcibly interrupted, check for a pending transaction before removing a leftover `.local/diagnostic-runs/probe.lock`.

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
npm run audit:high
```

The start and test commands check for the configured sandbox 2.14.0 binary and the compiled contract before running. If either is missing, follow the setup commands above. The contract checks deploy to a real sandbox, reject initialization twice, transfer funds, advance sandbox time, and exercise repeated upkeep, death, and the fifteen-day live rate. The browser test starts its own sandbox, advances its time through a test-only endpoint, and checks the displayed funds and life. Test processes need permission to bind local ports. They require no paid inference or personal keys.

## Dependencies and assistance

The contract uses NEAR SDK and `uint`; the local service and verification use NEAR Workspaces, TypeScript, tsx and Playwright. Exact versions are recorded in the lockfiles. The sandbox tooling overrides its `tar` dependency to a patched version; run `npm run audit:high` to check for high and critical advisories, or `npm audit` to see all severities. The latest audit still reports low and moderate findings. This tooling is for local development only, not a hosted service. npm 12 blocks dependency install scripts by default; the explicit sandbox installer above avoids relying on the older binary that dependency would otherwise install.

This initial implementation was developed with AI assistance. It has not been deployed or audited for real-money use.
