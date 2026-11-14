# Launch runbook (human-run)

Status: **draft, nothing here has been executed.** Every step that touches a live network, an account, a key, a hosting provider, GitHub visibility, or the event is run by the human, or by an agent only after the human approves that specific step. Drafting this file is not completion of any step in it. The irreversible lock in section 8 requires explicit approval at the gate shown there.

Written against commit `e8e5ae4` (issues #5 to #9 merged; issues #10, #11, #12 not yet merged). Facts about the code below were read from that commit. Section 1 lists what must be rechecked after #10 to #12 merge.

## 0. Read first: what the code does not do yet

These are findings at `e8e5ae4`. Each decides which launch path is possible.

1. **The service is a local-sandbox process only.** `service.ts` starts its chain with `Worker.init()`, creates a disposable `challenger` account whose secret key it hands to any browser through `GET /api/wallet`, and mints test funds through `POST /api/wallet/fund`. It binds `127.0.0.1` only. `public/index.html` hard-codes the labels `LOCAL SANDBOX · TEST MONEY` and `LOCAL DEMONSTRATION · EPHEMERAL SANDBOX WALLET · NO LIVE WAGERING`. The README says not to expose it. There is no testnet RPC mode, no real wallet connection, and no code path that uses the final account's restricted key from a secret store.
2. `RECKON_PROVIDER_MODE=live` changes only the evidence, model, and reference providers. It still publishes to the local sandbox contract.
3. **The live initializer has no receipt-proof configuration.** `new_live` calls `new` with `receipt_genesis = None`. On testnet, `update_receipt_verifier` and `reconcile_payment` panic with "Receipt proofs are not configured for this network". `retry_payment` refuses while a transfer is in flight. A payment whose callback never arrives therefore cannot be recovered on testnet. A transfer that fails normally (callback runs, result is a failure) is retryable. The README states that testnet proof support is not implemented.
4. `GET /api/predictions`, `/api/life`, `/api/config` and the evidence download route are read-only and suitable for public use. The `RECKON_TEST=1` routes (`/test/*`) must never be enabled on a public host.

Consequences:

- **Path A (hosted testnet experience)** needs a testnet-capable service and browser that do not exist at `e8e5ae4`. Issue #12 describes a "real browser-to-testnet" rehearsal and may deliver them. After #12 merges, verify the list in section 1.4. If anything on that list is missing, stop. The spec says to return changes to the trust model or experience to the user for a scope decision, so do not improvise a hosted wallet or hosted service.
- **Path B (public repository, reproducible local demonstration, recorded video)** needs no hosting. The live event rules explicitly accept a local-only demonstration when the repository is public and reproducible and the post includes a video (`event-requirements.md`). Hosting is described there as "a plus".
- The final lock (section 8) only makes sense when a real testnet agent exists, so it belongs to Path A. Under Path B the lock is not performed, and the README and video must say that no lock exists. Do not imply one.

## 1. Inputs, gates, and what to rerun

### 1.1 Values only the human can supply (none are invented here)

| Item | Needed for |
| --- | --- |
| Final agent account id (testnet) and who holds its key | sections 5 to 9 |
| Keeper account id (testnet) and its key custody | sections 5, 10 |
| Initial bankroll, operational reserve, allowance, from issue #12's measurements | section 6, 7 |
| Hosting provider and spend limit (ADR 0005 allows up to 5 USD per month for evidence storage only; app hosting is a new decision) | section 10 |
| Secret store for service secrets | section 10 |
| Mainnet payout account, lead name, email, team size, tracks, consent | `submission-payload-template.md` |
| Whether any other hackathon project exists (rules require disclosure) | README |
| The exact AI tools used and extent (README disclosure) | README |

### 1.2 Go or no-go gates (IST; proposed, human adjusts)

| Time | Gate |
| --- | --- |
| 18:40 | Human returns. Merge status of #10, #11, #12 checked. Section 1.3 started. |
| 20:00 | **Decision D1.** If #12 has not produced a passing testnet rehearsal, a testnet-capable service, and a measured allowance and reserve, choose Path B. Do not start section 5. |
| 20:45 | Last start for the lock approval gate (section 8). Later than this the lock is not rushed; use Path B. |
| 21:15 | Backup demonstration recorded (section 12). |
| 22:00 | Target submission start (internal target). |
| 04:30 (15 Nov) | Hard stop for any submission step; one hour of margin before 05:29. |
| 05:29 (15 Nov) | Official deadline (14 Nov 23:59 UTC). |

The spec reserves the final six working hours for verification and submission. From 18:40 to 22:00 is 3 h 20 min, so the reserve is already shortened. Prefer cutting scope (Path B) over compressing verification.

### 1.3 Rerun after #10, #11, #12 are merged (final acceptance)

I could not verify any of the following because those issues are not in my worktree. Rerun all of it on the merged release candidate and record results with the commit SHA.

1. Merge all three. Confirm `git status` is clean and CI on the merged commit is green (a push is human-gated).
2. Fresh clone into an empty directory (not the working checkout). Follow only the README, as a stranger would. Record every place the README was insufficient.
3. Commands, in CI order (`.github/workflows/ci.yml` is the reference; one at a time, because sandbox and browser tests bind local ports):
   `npm ci --ignore-scripts`, `./scripts/install-sandbox.sh`, `npm run build:contract`, `npm run lint`, `npm run typecheck`, `npm test` (diagnostic validation, callback, code, contract, settlement, payment reconciliation, then Playwright), `npm run test:diagnostic-contract`, `npm run audit:high`.
4. The #11 one-command credential-free local life: run it twice, confirm it reaches death within its bound, and confirm it exits unsuccessfully when an assertion is broken (ask the #11 author how to provoke that).
5. The #10 measurements: keyboard, 200% text, reduced motion, non-color cues, frame and layout-shift numbers, transfer sizes. Check that the figures in the README match the evidence files, not the targets.
6. The #12 evidence: transactions, code hash, key permissions, measured costs, chosen settings. Check that each README number (settlement window, reference age, cooldown, minimum stakes, rounding, confidence range, allowance, reserve) equals the setting compiled into the release contract and service.
7. Re-run the README audit as a separate pass (`readme-audit.md` was deliberately not written in this branch). It must check every factual claim against the merged code and tests and must land before the final README is published.
8. Existing browser tests worth naming in the acceptance record (current names): `one browser request publishes fixed terms and downloadable evidence`, `unchallenged round resolves into public accuracy`, `challenger win returns both stakes`, `stalled oracle observation voids ...`, `failed payout stays visible ...`, `a missing payment callback can be recovered ...`, `death is permanent while an outstanding challenged round settles`, plus the wallet-preparation cases. Contract suites: `tests/contract.ts`, `tests/settlement-contract.ts`, `tests/payment-reconciliation.ts`.

### 1.4 Path A prerequisites to confirm in the merged code

Mark each present or missing. Any "missing" means stop and escalate for a scope decision.

- [ ] A service mode that talks to a testnet RPC, uses a configured final account, signs `publish_prediction` with the restricted key from a secret store (not from disk in the repository), and uses a separate keeper account for `request_settlement`, `void_unsettled_prediction`, and payment recovery.
- [ ] A browser path that connects a real testnet wallet and shows `testnet` (not `LOCAL SANDBOX`) labels, including the footer and the consent text.
- [ ] `/api/wallet`, `/api/wallet/fund`, and every `/test/*` route are absent or refuse in hosted mode.
- [ ] The service binds a configurable address and runs behind TLS.
- [ ] Cooldown and daily model budget state survive a redeploy (today they live in `.local/runtime/forecast-budget.json` on local disk).
- [ ] The receipt-proof gap for testnet is either closed or disclosed in the README and in the UI's payment-failure copy.
- [ ] A documented manual command so anyone can call `request_settlement` or `void_unsettled_prediction` if the keeper is down.

## 2. Evidence folder (not in the repository)

Create an empty directory outside the checkout for all captured evidence, for example `~/reckon-launch-evidence/2026-11-14/`. Save every command output with `tee`. Commit only sanitized summaries (no keys, no tokens, no payload). Nothing in this folder is committed by default.

## 3. Freeze the release candidate

1. Record `git rev-parse HEAD`, `git status --short`, `node --version`, `rustc --version`, `cargo --version`, and `near --version`.
2. Tag nothing and push nothing until the human says so. If the human wants tags, `hackathon-submission` is the one the rules name; `pre-hackathon` is only needed if baseline code exists (history shows none).

## 4. Build and inspect the release contract

1. `npm run build:contract` builds three artifacts: the production Wasm, a **callback-fault test artifact**, and the oracle fixture. The same cargo output path is rebuilt, so confirm which file you deploy: `contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm` is the production one; `reckon_contract_callback_fault.wasm` must never be deployed.
2. Record `sha256sum` and size of the production Wasm.
3. Confirm the fault hook is absent. On an existing local build that already contains the issue #7 methods, `grep -a -c set_payment_callback_fault` printed 0 for the production file and 3 for the fault artifact. Repeat on the release candidate and require 0.
4. Confirm the public method surface equals this allowlist. The list below was read from the existing production Wasm with Node's `WebAssembly.Module.exports`; regenerate it from the release candidate and compare. Any method not on the list stops the launch.
   `accrue, active_prediction, challenge_prediction, contract_source_metadata, get_prediction, life, list_predictions, new, new_live, on_payment_complete, oracle_on_call, prediction_summary, publish_prediction, quote_prediction, receipt_verifier_head, reconcile_payment, request_settlement, retry_payment, update_receipt_verifier, void_unsettled_prediction` (plus `memory`, `__data_end`, `__heap_base`).
   ```sh
   ./scripts/with-local-env.sh node -e "const m=new WebAssembly.Module(require('fs').readFileSync('contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm'));console.log(WebAssembly.Module.exports(m).map(e=>e.name).sort().join('\n'))"
   ```
   There is no method to withdraw funds, upgrade code, add or remove keys, change the oracle, or restore authority. `on_payment_complete` is `#[private]`.
5. Do not use host-import names as evidence of "no administrative path". The Wasm imports every `promise_batch_action_*` host function (add key, deploy, delete account, stake) because the SDK's generic promise code links them, so their presence proves nothing. The evidence is the exported-method allowlist above plus the source: at `e8e5ae4` the only promise actions constructed in `contract/src/*.rs` are the oracle `oracle_call` function call, a `transfer` to the recorded beneficiary, and the self callback `on_payment_complete`. Re-run `grep -n -E "add_full_access_key|add_access_key|deploy_contract|delete_key|delete_account|\.stake\(|create_account|Promise::new|\.transfer\(|function_call\(" contract/src/*.rs` and review every hit.
6. `new` and `new_live` are public initializers. An uninitialized contract can be initialized by anyone. Section 6 therefore deploys and initializes in one transaction. Never deploy without the init call.
7. Do not claim the build is reproducible. Nothing in the repository pins a reproducible build container. The claim that can be made is that the on-chain code hash equals the SHA-256 of a published Wasm file built from a named commit.

## 5. Accounts and funds (testnet; human-gated)

Nothing here is run by an agent.

1. Pick the final account id. Do not reuse the rehearsal account or the diagnostic scratch account. Choose a name that identifies it as the agent and, if a replacement is ever needed, can be told apart from it.
2. Create it with the CLI (`near account create-account` offers `sponsor-by-faucet-service` for testnet, `fund-myself`, and `fund-later`; confirm the exact current options with `--help` on the day) or any method the human prefers. Record its full-access public key(s). Keep the secret only where the human controls it.
3. Create a separate keeper account with its own key. The keeper pays gas for settlement, void, and payment recovery; it holds no bankroll. Its key goes to the service secret store.
4. Fund the final account before initialization. `new` requires `account_balance >= initial_bankroll + operational_reserve`. That check reads the balance the runtime reports to the contract, which I expect to include the part that storage staking reserves (confirm this in the rehearsal), so the reserve must be sized to cover storage and operations on top of what the check requires.
5. Sizing references (arithmetic from recorded figures, **not** measurements of the release candidate; issue #12 owns the measured values):
   - Storage staking at protocol 88 is recorded as 10^19 yoctoNEAR per byte (`docs/research/price-settlement-feasibility.md`). The production Wasm at `e8e5ae4` is about 442 KB, so code alone locks roughly 4.4 NEAR.
   - The local complete-round measurement grew contract state by 604 bytes per challenged round, about 0.006 NEAR (`docs/evidence/complete-round-local.json`).
   - Each oracle request attaches 0.02 NEAR from the contract balance before the oracle refunds the unused part. Recorded testnet worker charges were about 0.0013 to 0.0015 NEAR per paid refresh, and the CLI-reported transaction fee for the caller was about 0.0006 to 0.0016 NEAR (`docs/evidence/testnet-latency-cost-samples.json`). Failed, retried, and concurrent cases are not covered by these samples.
6. Keep the rehearsal account until the final account is verified. It is the fallback if a deployment step fails before the lock.

## 6. Deploy and initialize in one transaction (human-gated)

Preconditions: sections 3 and 4 pass; the final account is funded; the human has the measured settings from #12 written down.

```sh
near contract deploy <FINAL_ACCOUNT_ID> \
  use-file contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm \
  with-init-call new_live json-args '{
    "initial_bankroll": "<YOCTO, FROM #12>",
    "operational_reserve": "<YOCTO, FROM #12>",
    "prediction_public_key": "<ed25519:RESTRICTED_PUBLIC_KEY>"
  }' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
```

- The subcommand names above were checked against `near-cli-rs 0.31.1 --help` offline (`deploy use-file with-init-call prepaid-gas attached-deposit network-config`). They were **not** run against a network. Confirm with `--help` before running.
- `new_live` fixes the idle life at fifteen days and the oracle at `price-oracle.testnet`; it takes no other settings. All other constants (30 s challenge window, 5 minute deadline, 120 s cutoff, 2% cap, minimum stakes, 10% to 90% confidence) are compiled into the Wasm and cannot be changed after deployment. If #12 changed any of them, they are already in the release Wasm.
- The restricted key pair is generated by the human (for example `near account get-public-key` or another key generator). The secret goes to the service secret store at once. Do not paste it into chat, a terminal that logs, or the repository.

Verify, saving outputs:

1. Account summary and code hash. The on-chain `code_hash` is the base58 encoding of the Wasm's SHA-256. Compute the local value with the helper below and require equality:
   ```sh
   near account view-account-summary <FINAL_ACCOUNT_ID> network-config testnet now | tee evidence/account-after-deploy.txt
   ```
   ```js
   // node base58.mjs reckon_contract.wasm   (prints base58(sha256(file)))
   import {createHash} from 'node:crypto'; import {readFileSync} from 'node:fs';
   const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
   const b=createHash('sha256').update(readFileSync(process.argv[2])).digest();
   let n=BigInt('0x'+b.toString('hex')),s='';while(n>0n){s=A[Number(n%58n)]+s;n/=58n}
   for(const x of b){if(x)break;s='1'+s} console.log(s);
   ```
   (The helper was checked against the known vector `base58("hello world") = StV1DL6CwTryKyV`.)
2. `near contract call-function as-read-only <FINAL_ACCOUNT_ID> life json-args '{}' network-config testnet now` returns the expected `initial_bankroll`, `operational_reserve`, `idle_life_ns = 1296000000000000` (15 days in ns), `dead = false`.
3. `... as-read-only <FINAL_ACCOUNT_ID> receipt_verifier_head json-args '{}' ...` returns `null` (expected on testnet; see section 0 item 3).
4. Try to initialize again with the full-access key and require the failure (a negative test that costs a little gas): call `new_live` as a transaction and save the failure. Do this before the lock; it cannot be run afterwards.

## 7. Restricted prediction key and its finite allowance (human-gated)

1. Add the restricted key (the allowance value comes from #12's measurements; do not use the local 5 NEAR default unless #12 says so):
   ```sh
   near account add-key <FINAL_ACCOUNT_ID> grant-function-call-access \
     --allowance '<NEAR, FROM #12>' \
     --contract-account-id <FINAL_ACCOUNT_ID> \
     --function-names publish_prediction \
     use-manually-provided-public-key <ed25519:RESTRICTED_PUBLIC_KEY> \
     network-config testnet sign-with-legacy-keychain send
   ```
   (Subcommands checked offline against `--help`; not run.)
2. Read the key list as evidence, twice: once with the CLI and once by raw JSON-RPC so the evidence does not depend on the CLI:
   ```sh
   near account list-keys <FINAL_ACCOUNT_ID> network-config testnet now | tee evidence/keys-before-lock.txt
   curl -s <TESTNET_RPC_URL> -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"keys","method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"<FINAL_ACCOUNT_ID>"}}' | tee evidence/keys-before-lock.json
   ```
   Require exactly the full-access key(s) the human knows about plus one `FunctionCall` key with `receiver_id` equal to `<FINAL_ACCOUNT_ID>`, `method_names` equal to `["publish_prediction"]`, and `allowance` equal to the intended value. `<TESTNET_RPC_URL>`: the code hard-codes `https://rpc.testnet.near.org` for the oracle reference; I could not verify today that endpoint is still served, so check it and use whichever endpoint is current.
3. Negative tests with the restricted key. Each must fail at transaction validation, before any contract code runs, and must not reduce the allowance. Run them with a single-user shell that does not log history (`set +o history`, or `HISTFILE=/dev/null`). Passing a secret key as a CLI argument exposes it to the local process list and shell history; the key is restricted and finite, which limits the damage, but keep the session private and rotate nothing else. Alternatively import the restricted key into the legacy keychain first.
   - A transfer of 0.001 NEAR to a human-controlled account: expect rejection (action not permitted for a function-call key).
   - A call to any method other than `publish_prediction`, for example `accrue`: expect a method-name mismatch rejection.
   - A call to `publish_prediction` with an attached deposit: expect rejection (function-call keys cannot attach a deposit).
   - Re-read the key list and require the allowance unchanged. If it changed, stop and record the cause.
4. Positive authorization probe (recommended). The contract checks the signer key before it validates the decision, so a call that is valid for the key but invalid in content proves authorization without creating a prediction. Sign `publish_prediction` with the restricted key, `reference_multiplier "1"`, `reference_decimals 0`, `decision "abstain"`, a valid 64-hex `evidence_hash`, and a valid `https://` `evidence_url`, with a modest `prepaid-gas`. Expected: the transaction fails inside the contract with **"Decision must be yes or no"**. The message "Prediction key is not authorized" or any key-permission rejection means the key is wrong; stop. This changes no contract state but it spends gas from the allowance. **Measure the allowance before and after** to learn the real per-call debit and whether unused prepaid gas is credited back; do not assume either. A key that cannot publish discovered after the lock would be unfixable, so this check belongs before the lock.
5. Compare the stored key against the service's key: the public key printed from the secret in the service's secret store must equal `<RESTRICTED_PUBLIC_KEY>` and the `prediction_public_key` the contract was initialized with (visible in no view; the init call's arguments are in the deployment transaction).
6. Allowance arithmetic for the record (from constants, not measured): the local service prepays 250 Tgas per publish. At the 100,000,000 yoctoNEAR per gas minimum price that is up to 0.025 NEAR per call, so a 5 NEAR allowance covers at most 200 calls if prepaid gas is never credited back. #12 should replace this with a measured figure and headroom. Exhaustion stops publication only; settlement and payment recovery by other callers continue (ADR 0007).

## 8. Pre-lock evidence and the human approval gate

### 8.1 Lock card (fill every line from fresh on-chain reads, not from memory)

```
Network:                       testnet
Final agent account:           <FINAL_ACCOUNT_ID>
Release commit:                <SHA>
Wasm sha256:                   <HEX>
On-chain code hash (base58):   <HASH>          == base58(sha256) ?  <yes/no>
Full-access keys to delete:    <ed25519:...>, <ed25519:...>   (all of them)
Key that must remain:          <ed25519:RESTRICTED_PUBLIC_KEY>
  receiver / methods:          <FINAL_ACCOUNT_ID> / ["publish_prediction"]
  allowance:                   <NEAR>
Balance / storage locked:      <NEAR> / <NEAR>
initial_bankroll / reserve:    <NEAR> / <NEAR>
Negative tests passed:         transfer / other method / deposit / re-init
Authorization probe:           failed with "Decision must be yes or no"
Hosting and evidence chosen:   <...>
```

### 8.2 Preconditions (all must be true; otherwise do not ask for approval)

- [ ] Section 1.3 final acceptance passed on this exact commit, and the README matches the behavior.
- [ ] Section 1.4 prerequisites are present (or Path B was chosen, in which case this gate does not apply).
- [ ] Section 6 and 7 verifications are saved.
- [ ] The restricted key's secret is in the service secret store and backed up securely; the human can recover it.
- [ ] The human has written down what the lock removes (below) and accepts it.
- [ ] A backup demonstration exists (section 12).
- [ ] It is before the 20:45 IST gate in section 1.2, or the human explicitly accepts a later time.

### 8.3 What the lock does and does not do

- After it, nobody can: withdraw or transfer the account's funds, deploy or replace code, add or remove any key, delete the account, or change any initialization value. A defect requires a clearly identified replacement agent account; there is no in-place repair (ADR 0007 and the specification).
- Anyone can still send NEAR to the account. Those funds do not become bankroll (internal accounting ignores them) and do not revive a dead agent.
- The restricted key's allowance cannot be refilled. When it is exhausted, publication stops while settlement, voiding and payment recovery by any other account continue.
- Any other full-access key on the account that was not deleted keeps owner power. The list in 8.1 must be complete.

### 8.4 Approval statement (the human types this, with the real account id)

> I approve permanently deleting all full-access keys of `<FINAL_ACCOUNT_ID>` on testnet, leaving only the restricted `publish_prediction` key `<ed25519:RESTRICTED_PUBLIC_KEY>`. I understand this is irreversible.

**Stop here. Do not run section 9 until that approval is given in the human's own words in the current session.** Approval for an earlier step, an earlier draft of this card, or a different account does not count.

## 9. The lock (after approval only)

1. Save a fresh key list. Confirm the full-access list equals the lock card.
2. Delete every full-access key in one transaction (one transaction means there is no half-locked state):
   ```sh
   near account delete-keys <FINAL_ACCOUNT_ID> \
     public-keys <ed25519:FULL_ACCESS_1>,<ed25519:FULL_ACCESS_2> \
     network-config testnet sign-with-legacy-keychain send | tee evidence/delete-keys.txt
   ```
   (Subcommands checked offline against `--help`: `delete-keys <OWNER_ACCOUNT_ID> public-keys <PUBLIC_KEYS> network-config`; not run.) Record the transaction hash and open it in a block explorer.
3. Verify only the intended key remains, with the CLI and raw JSON-RPC (same commands as 7.2, saved as `keys-after-lock.*`). Require exactly one key: the restricted one, with the allowance from the card. Record the block height.
4. Preserve deployed-code evidence after the lock: `view_account` (code hash unchanged and equal to the card), and a `view_code` read whose SHA-256 matches the published Wasm. Keep the Wasm file, its hash, the commit SHA, and the toolchain versions together in the evidence folder.
5. Demonstrate that the old authority fails. Each attempt uses a full-access key that was just deleted (still in the human's keychain). Each must be rejected by the network because the key no longer exists on the account, and each failure output is saved:
   - transfer of 0.001 NEAR from `<FINAL_ACCOUNT_ID>` to a human-controlled account;
   - adding a new full-access key;
   - deploying any Wasm.
   The expected network error is an access-key-not-found style rejection. I have not observed this on a live network, so record the actual text. If any of the three succeeds, stop at once and treat the lock as failed: record the transaction, do not continue the demo, and use a replacement account.
6. Check that the contract still works for everyone: `life`, `active_prediction`, `prediction_summary` reads succeed; a challenger account can still call `challenge_prediction` when a prediction exists (section 11).
7. Write the sanitized evidence summary (no keys, no tokens) and commit it only if the human asks.

## 10. Host browser, service, and evidence through at least 25 November (Path A only)

The rules require a hosted demo only as a plus (minimum through 18 November, ideal 25 November); the spec and issue #13 ask for reliability through judging. No credentials or provider are chosen here. The options are described from general knowledge of such services; **I did not check current plans, limits, or prices**, so confirm each before choosing.

### 10.1 What needs to stay reachable

1. The browser application and the service API (`/api/predictions`, `/api/life`, `/api/config`, `/api/forecast`, evidence route).
2. A keeper process running all the time, so rounds settle without a person. If the keeper is down, anyone can still call `request_settlement` and `void_unsettled_prediction`, so the README needs the manual commands.
3. Public evidence snapshots (Vercel Blob on Hobby per ADR 0005, with the accepted risk that quota exhaustion can pause access for up to thirty days).
4. A downloadable archive of every snapshot (ADR 0005: `npm run archive:evidence -- <service-url> <new-dir>`, then a GitHub Release, which is human-gated).

### 10.2 Hosting options and trade-offs

| Option | Fits | Costs and risks |
| --- | --- | --- |
| Small always-on app host (container or web-service platform with a persistent disk) | Runs the service and keeper as one long-lived process, TLS included | Free tiers commonly sleep when idle, which would stop the keeper; a paid instance is likely needed (new spend decision). Persistent disk is needed for the budget file and local evidence copy. |
| Serverless platform for the static app plus the same always-on host for the keeper | Cheap, fast static serving | The keeper and `/api/forecast` still need an always-on process. Two moving parts. |
| Static site that reads the chain through public RPC and evidence through Blob, with `Ask Reckon` disabled or pointing at the service | The public record survives even if the service sleeps; easy to keep up to 25 November | Reduced experience; `Ask` needs the service. Needs code that does not exist at `e8e5ae4`. |
| A machine the human owns plus a tunnel | No hosting bill | Depends on that machine staying on and connected for ten days; shared 4 GB laptop and sleep settings are a real risk. Weakest for "reliable through judging". |

Common requirements whichever is chosen:

- Secrets (`NEAR_AI_API_KEY`, `NEAR_AI_MODEL`, `BLOB_READ_WRITE_TOKEN`, the restricted prediction key, the keeper key) live in the host's secret configuration or a password manager, never in the repository, build logs, or screenshots. Back up the restricted key and keeper key securely. Revoke the API and Blob tokens after judging.
- A redeploy resets local disk. At `e8e5ae4` the daily model cap (12 attempts per UTC day) and the 30 s cooldown are stored on local disk, so a redeploy resets them and they are per-machine, not per-visitor. Anyone can spend the day's model budget. This is a known limitation; either persist the file or disclose it.
- The local evidence copy in `.local/evidence` is not durable on ephemeral disk. The Blob copy and the on-chain fingerprint are the durable record; the evidence route on the service can return 404 after a redeploy even though the Blob URL still works.
- Confirm the Blob project is on the Hobby plan, public, with expiry off (ADR 0005). A billing alert is not a spending cap.
- Set a calendar reminder for 26 November to export an archive and decide whether to retire hosting; ADR 0005 says snapshots have no automatic expiry and that an archive must be preserved if hosting is retired.

### 10.3 Verification of public links (record dates and times)

- [ ] App URL loads from a clean browser profile on desktop and on a phone over mobile data.
- [ ] `/api/config` reports testnet and the final account id; `/api/life` matches a direct `life` view call.
- [ ] A snapshot URL from a published prediction downloads, and its SHA-256 equals the on-chain `evidence_hash`.
- [ ] The repository link opens signed out; the README renders; the `LICENSE` is visible.
- [ ] Re-check all of the above on 25 November and after any redeploy.

## 11. Phone layout and one complete live moment (after the final deployment and lock)

### 11.1 Phone layout

Use a real phone if one is available; otherwise use browser device emulation and say so in the evidence. Cover at least a 360 by 800 and a 390 by 844 viewport. Require:

- [ ] Terms (side, confidence, stakes, return, deadline, network, loss risk) and the one primary action are legible together without horizontal scrolling.
- [ ] Text at 200% still shows the controls.
- [ ] No state needs hover. Reduced-motion and keyboard paths work (#10's evidence is the reference).
- [ ] Screenshots of: idle, thinking, challenge-open, wallet approval, waiting, resolved. Save with timestamps.

### 11.2 Live moment

Run one complete round on the final deployed system, with the human as challenger, and capture it with the screen recorder already running.

1. Ask Reckon. Record the published terms and the evidence URL and fingerprint; verify the fingerprint against the downloaded snapshot and against the on-chain record.
2. Challenge from a real testnet wallet within thirty seconds. Record the transaction hash, the signed, submitted, and confirmed states, and the balances before and after.
3. Wait for the five-minute deadline and the settlement. Record the oracle request transaction, the callback, the outcome, the payout or refund receipt, and the final balances. Confirm the UI shows "paid" only after the transfer receipt succeeded.
4. Pass criteria: the displayed result equals the on-chain `get_prediction` record, the balance changes equal the recorded amounts, the obligations reported by `life` (spendable, committed, challenger custody, retired, reserve, and pending payment liabilities) remain covered by the account's actual balance, and nothing in the interface claims more than the README does.
5. Acceptable honest alternatives are an abstention, an unavailable-provider message, or a void with refund, each with its own evidence. Do not stage, replay, or fake any step. If no complete round is possible before the target time, say so in the video and the post.
6. Each live round costs model credit and oracle fees; the keeper and the human's wallet need balance. Record the cost.

## 12. Backup demonstration (record before final polish)

- Record one uninterrupted take of the full flow: the same live moment (Path A) or the clean local run (Path B), with a visible clock or terminal timestamp. Keep the raw file untouched; make edits only on a copy.
- Record at the highest quality the machine handles comfortably; the shared 4 GB machine may stutter under a browser plus sandbox, so close other work first.
- Store the raw file and its `sha256sum` in two places (local disk and an external drive or private cloud folder). Uploading anywhere public is human-gated.
- If the live round fails mid-recording, keep that recording too; failures are evidence and may belong in the README's limitations.
- The five-minute horizon and 120-second settlement window are real wall-clock time in every mode (the contract fixes them), so a full local round takes a little over five minutes unless sandbox time is advanced by the `RECKON_TEST` tooling, which is for tests and must not be shown as the product's behavior. The final video may cut the wait with a visible on-screen card such as "five minutes skipped"; never present the cut as real time.

## 13. Post and submit (human-run)

Order matters because the demo URL comes from the post.

1. Confirm the repository is public and the README is final (re-run the README audit pass first).
2. Upload or attach the final video (video script: `demo-script.md`).
3. The human writes and publishes the X post from `x-post-draft.md` and sends its URL.
4. The human supplies every payload value; fill `submission-payload-template.md` in a private file outside the repository; the human confirms the exact JSON.
5. Submit once; handle statuses as in `event-requirements.md`. Record the response and time.
6. Afterwards: keep hosting and keeper alive; no further pushes that change behavior without telling the human; use the change-request page for corrections.

## 14. Fallback matrix

| Condition | Action |
| --- | --- |
| #12 incomplete at 20:00 IST | Path B; do not create the final account or lock. Say "local sandbox" everywhere. |
| Any item in 1.4 missing | Stop Path A; escalate for a scope decision. |
| Wasm export list differs from the allowlist, or the fault hook is present | Do not deploy. Rebuild and re-inspect. |
| Authorization probe says the key is not authorized | Do not lock. Fix the key (still possible before the lock). |
| Old-key demonstration succeeds | Lock failed. Stop, record, treat the account as compromised, use a replacement. |
| Live round cannot complete | Record the honest failure state; do not fake a result; consider the backup demonstration in Path B form. |
| Hosting down during judging | Restore the service; the repository, video, and on-chain record remain; manual settlement commands are in the README. |
| Submission API returns 403 | Do not retry. Tell the human. |
| 409 | Do not change the repository link or email; use the change-request page only if a saved submission is wrong. |
