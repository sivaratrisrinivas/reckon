# License, dependency, and disclosure check

Status: read-only check made on 14 November 2026 against commit `e8e5ae4` (issues #10 to #12 not yet merged). It changes no dependency, no `LICENSE`, and no README text. Re-run the counts after the final merge.

## Verdict

- The `LICENSE` file is present and valid MIT text. It is complete for the hackathon's requirement (any license, file present, repository public).
- Every third-party license found in the scanned dependencies is permissive, except two MPL-2.0 crates in the contract's dependency graph (file-level copyleft, used unmodified), which the README does not mention.
- The README's dependency and AI-assistance disclosures are present but thin. The gaps and proposed wording are listed below. The human must supply the facts about which AI tools were used and how.

## 1. `LICENSE`

| Check | Result |
| --- | --- |
| File exists at the repository root | Yes (`LICENSE`, 1,076 bytes) |
| License | MIT, standard text, "Copyright (c) 2026 Reckon contributors" |
| Detected by GitHub | `gh repo view` reported license key `mit` |
| Repository visibility | `gh repo view` reported PUBLIC at the time of this check (a read; no visibility change was made) |
| Copyright holder | A project name, not a person or legal entity. Valid for MIT. The human may prefer a named holder; that is a decision for the human, not changed here. |
| Event requirement | "Any license; MIT is fine; add a LICENSE file; the repository stays public through judging" (live rules) |

Gap: none that blocks submission. Decision for the human: the copyright holder wording.

## 2. Dependencies

Lockfiles are committed for every package manager in use: `package-lock.json`, `contract/Cargo.lock`, `oracle-fixture-contract/Cargo.lock`, `diagnostic-contract/Cargo.lock`. Builds use `npm ci` and `cargo build --locked`.

### 2.1 Direct dependencies (from `package.json` and the Cargo manifests)

| Group | Packages |
| --- | --- |
| npm runtime | `@vercel/blob` 2.9.0, `near-api-js` 5.1.1, `near-workspaces` 5.0.0, `tsx` 4.21.0 |
| npm development | `@eslint/js` 10.0.1, `@playwright/test` 1.65.0, `@types/node` 25.2.3, `esbuild` 0.27.7, `eslint` 10.14.0, `typescript` 5.9.3, `typescript-eslint` 8.72.2 |
| Rust (production contract) | `near-sdk` =5.30.1, `uint` =0.10.0 (development: `near-sdk` with `unit-testing`) |
| Rust (oracle fixture) | `near-sdk` =5.30.1 |
| Rust (diagnostic scratch contract) | `near-sdk` =5.30.1, `uint` =0.10.0 |
| Toolchain | Rust 1.95.0 with `wasm32-unknown-unknown`, Node 26.13.0, NEAR sandbox (`neard` 2.14.0, downloaded and SHA-256 checked), Chromium via Playwright, `near-cli-rs` 0.31.1 (only for the documented testnet diagnostic commands) |
| External services | Coinbase public candles API, NEAR AI Cloud (model inference), `price-oracle.testnet` (third-party oracle), Vercel Blob (evidence storage), GitHub Actions (CI) |

### 2.2 License scan

npm: every package in `package-lock.json` whose `package.json` is installed in the shared `node_modules` was grouped by its declared license field. Result for 173 runtime and 94 development packages that were present:

| Scope | License | Count |
| --- | --- | --- |
| runtime | MIT | 129 |
| runtime | ISC | 21 |
| runtime | Apache-2.0 | 13 |
| runtime | BlueOak-1.0.0 | 5 |
| runtime | MIT AND Apache-2.0 (`near-abi`, `near-api-js`, `near-workspaces`) | 3 |
| runtime | BSD-2-Clause | 2 |
| development | MIT 67, Apache-2.0 16, BSD-2-Clause 6, ISC 3, BSD-3-Clause 1, BlueOak-1.0.0 1 | 94 |

No package declared an unknown or restrictive license. 26 lockfile entries had no installed manifest (platform-specific optional packages that were not installed on this machine), so their licenses were not read.

Rust: `cargo metadata --locked --offline --filter-platform wasm32-unknown-unknown` for `contract/` reported 141 third-party crates. Licenses: MIT or Apache-2.0 variants (the large majority), `Unlicense OR MIT` 6, `Zlib` variants 3, `BSD-2-Clause` 1, `BSD-3-Clause` 1, `Apache-2.0 OR BSL-1.0` 1, `(MIT OR Apache-2.0) AND Unicode-3.0` 1 (`unicode-ident`), and **`MPL-2.0` 2 (`wee_alloc` 0.4.5 and `memory_units` 0.4.0)**.

`cargo tree -i wee_alloc` confirms `wee_alloc` is a normal dependency of `near-sdk 5.30.1` and therefore part of the production contract's graph. MPL-2.0 is a file-level license; using the crates unmodified does not change the license of Reckon's own code, but notices should be kept and the README should list them. The oracle fixture and diagnostic contracts use the same `near-sdk` family; they were not scanned separately.

## 3. Disclosure completeness: gaps found in the README

| Topic | What the README says | Gap |
| --- | --- | --- |
| Dependencies | One paragraph names NEAR SDK, `uint`, NEAR Workspaces, `near-api-js`, `@vercel/blob`, TypeScript, `tsx`, Playwright; points to lockfiles; mentions two overrides | Does not name `esbuild` (browser bundle), ESLint and `typescript-eslint`, the NEAR sandbox binary, Node, Rust toolchain, or the MPL-2.0 crates. Does not list external services or say that using them has terms the user should check. |
| AI assistance | "This initial implementation was developed with AI assistance. It has not been deployed or audited for real-money use." | Does not name tools, say which parts (code, tests, specification, decisions, design), or say how the output was reviewed. The rules say AI-generated code must be listed in the README. The product itself also calls a model at runtime; this is described elsewhere, not under assistance. |
| Hackathon provenance | Nothing | The rules ask for a statement about baseline code (earlier code is baseline; only work built in the window is judged) and about any second project. History's first commit is dated 12 November 2026, after the 1 November start, so no baseline is evident. The README should say so, once the human confirms. |
| Real versus simulated | Strong in the forecast section: fixture mode is labelled simulated; "not testnet or mainnet"; fixtures are not fallbacks in live mode | Must be re-checked against the final interface after #10 to #12. If a testnet deployment is added, the README must state exactly which parts are testnet and which are simulated. |
| Trust and operational limits | Covered: oracle timing and caching, evidence hosting, off-chain inference, local wallet pattern, per-machine rate limits, no audit | Missing for a launch: keeper dependence and what anyone can do manually if it stops; the restricted key's finite allowance and exhaustion behavior (ADR 0007); lock status and what it does and does not mean; no receipt-proof support on testnet; the third-party oracle can return stale or null prices (observed in `docs/research/price-settlement-feasibility.md`); hosting and quota limits through judging. |
| Platform | "Run on Linux x86-64"; Node 26.13.0 pinned; Rust 1.95.0 pinned | Not stated that macOS and Windows are unsupported. `playwright install --with-deps` may need administrator rights. An automated screening check may stumble here. |
| License | README does not mention it | Add one line pointing to `LICENSE` (MIT). |
| Real-money statement | "Not deployed or audited for real-money use"; testnet scope | Add that the payout address in the submission is unrelated to the application and that no mainnet deployment exists. |

## 4. Proposed wording (the human confirms every fact; nothing below is applied)

Dependencies and assistance, replacing the README's paragraph:

```text
Dependencies. Contract: NEAR SDK 5.30.1 and uint 0.10.0 (Rust 1.95.0). The NEAR SDK pulls in the MPL-2.0 crates wee_alloc and memory_units, used unmodified. Service and tests: near-workspaces, near-api-js, @vercel/blob, tsx, TypeScript, esbuild, ESLint with typescript-eslint, and Playwright (Chromium), on Node 26.13.0. Local chain: NEAR sandbox (neard 2.14.0), downloaded with a pinned SHA-256. Exact versions are in package-lock.json and the Cargo.lock files; licenses of the scanned packages are permissive (MIT, Apache-2.0, ISC, BSD, BlueOak) apart from the MPL-2.0 crates above. External services used by live mode and the diagnostic: Coinbase public candles, NEAR AI Cloud, price-oracle.testnet, Vercel Blob; check their own terms before relying on them.

License. MIT, see LICENSE.

AI assistance. <HUMAN TO SUPPLY: tools used (for example Claude Code or Codex, as true), which parts they produced (code, tests, specification, decisions, design), and how the human reviewed them>. The product also calls an AI model at runtime (the model configured in NEAR_AI_MODEL; its identity is recorded in each evidence snapshot).

Hackathon provenance. <HUMAN TO CONFIRM: All code in this repository was written between 12 November 2026 and the submission, inside the event window; there is no pre-hackathon baseline. No other hackathon project is entered by the author.>
```

## 5. Searches for secrets and personal data (all read-only)

- Pattern searches over tracked files for Vercel Blob token prefixes, API-key shapes, private-key blocks, and long `ed25519:` secret-key strings found only the README's `getpass` helper that writes a key to `.env` (no value).
- The same patterns over every commit on every branch (`git log --all -G ...`, one pattern per search) found no hits.
- `.env` is listed in `.gitignore` and no `.env`, key, or credential file is tracked.
- No tracked file contains a local home path or an email address. Commit author addresses are visible to anyone once the repository is public. All 41 commit author entries visible to `git log --all` use a `gmail.com` address (the address itself is not recorded here). The human should know this; GitHub's noreply address can be used for later commits, and rewriting published history is not recommended this close to the deadline.
- The README and the research notes contain the name of a disposable testnet scratch account (`reckon-srinivas-probe-2026.testnet`) that includes a first name, and testnet transaction hashes. These are public testnet data; the human may keep or replace the account name before judging.
- These searches are not exhaustive. A dedicated scanner (for example `gitleaks`) before the repository is promoted would add confidence; none was run.

## 6. What I could not verify

- `npm audit` was not run (it contacts the npm registry; network use here was limited to read-only lookups of the event page and GitHub repository metadata). The README says the latest audit still reports low and moderate findings; that claim is unchecked here.
- The 26 uninstalled optional npm packages, the oracle fixture's and diagnostic contract's crate graphs, and the licenses of tools downloaded at setup (Node, the NEAR sandbox, Chromium) were not scanned.
- Whether any code in `oracle-fixture-contract/` or `diagnostic-contract/` was copied from the public oracle example the research notes cite. Nothing in the files says so, and nothing says it was not. The human should confirm provenance and, if anything was adapted, check that project's license and add attribution.
- Terms of service for Coinbase's public API, NEAR AI Cloud, the oracle, and Vercel Blob for a public demonstration.
- Anything that depends on issues #10 to #12.
