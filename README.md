# Reckon

Reckon is an experiment in an AI staking its own bankroll on its predictions. This initial local slice shows the agent's remaining life and funds on a real NEAR sandbox. It does not yet make forecasts or accept stakes. All funds in this demonstration are sandbox test money; this is not a testnet or mainnet deployment.

## Run on Linux x86-64

The verified versions are Rust 1.95.0 with `wasm32-unknown-unknown`, Node 26.13.0 and npm 12.2.2, NEAR SDK 5.30.1, and NEAR sandbox 2.14.0. Install Rust using [rustup](https://rustup.rs/) and Node using your preferred version manager. The `rust-toolchain.toml` selects Rust and its Wasm target. The sandbox installation script downloads the NEAR binary and verifies its SHA-256 hash.

```sh
npm ci --ignore-scripts
./scripts/install-sandbox.sh
export NEAR_SANDBOX_BIN_PATH=1
export NEAR_SANDBOX_BINARY_PATH="$PWD/.local/sandbox"
cargo build --manifest-path contract/Cargo.toml --release --target wasm32-unknown-unknown --locked
npm start
```

Open http://127.0.0.1:4389. The service starts a new sandbox and initializes a fresh agent each time it runs. Watch spendable bankroll decrease and retired bankroll increase as blocks advance; no wallet or key is needed. Stop with Ctrl-C. Set `PORT` to change the browser port. This is a local development tool: the sandbox dependency binds its RPC and network ports to all interfaces, so run it only on a trusted machine and network.

The local agent begins with 100 NEAR spendable and a separate 20 NEAR operational reserve. Its initial idle life is accelerated to 15 minutes. The intended live rate is fifteen days, not yet deployed. Upkeep is a configured rule, not an invoice, and retired funds remain on the account but cannot be used for new stakes. The reserve covers operational and storage needs; it is not agent bankroll. Direct transfers do not increase usable bankroll. A life view projects costs through the latest chain block, so it advances with sandbox blocks, not a separate browser clock.

## Verify

After the build above, install Chromium for Playwright and run the checks:

```sh
npx playwright install chromium --only-shell
npm run typecheck
npm test
```

The contract checks deploy to a real sandbox, reject initialization twice, transfer funds, advance sandbox time, and exercise repeated upkeep and death. The browser test starts its own sandbox, advances its time through a test-only endpoint, and checks the displayed funds and life. Test processes need permission to bind local ports. They require no paid inference or personal keys.

## Dependencies and assistance

The contract uses NEAR SDK and `uint`; the local service and verification use NEAR Workspaces, TypeScript, tsx and Playwright. Exact versions are recorded in the lockfiles. The NEAR Workspaces dependency tree currently has npm audit findings, including critical `tar` and high `near-sandbox` findings; this tooling is for local development only, not a hosted service. npm 12 blocks dependency install scripts by default; the explicit sandbox installer above avoids relying on the older binary that dependency would otherwise install.

This initial implementation was developed with AI assistance. It has not been deployed or audited for real-money use.
