# Issue #12 status: rehearsal with measured permissions and reserves

Branch `worktree-agent-a1c7086882fffc7e3`. Nothing live was run: no testnet transaction, no paid oracle call, no model call, no deployment, no `.env` read, no spending. Every measurement is from the production Wasm on the local sandbox with a fixture oracle ("local sandbox with fixture oracle, not live"). No live criterion is met.

## Acceptance criteria

1. Real market evidence, authenticated model inference, actual wallet, paid oracle refresh and callback, real challenger payout. **NEEDS HUMAN LIVE RUN, and cannot run with current code:** the service has no testnet mode and the browser uses an ephemeral sandbox signer (`docs/rehearsal/decisions-needed.md`, item 2). Scripts under `scripts/rehearsal/` prepare the contract-level part only (oracle, callback, gas, storage); they have never been executed.
2. Measure growth, storage, publication gas, oracle, settlement, recovery, model costs; finalize settings. **PARTIAL.** Local numbers recorded in `docs/evidence/rehearsal-local-measurements.json` (record growth about 593 bytes per prediction, gas for publication, take, settlement, void, retry; reconciliation figures reused from `PAYMENT_PROOF_MEASUREMENT`, the round figures from `COMPLETE_ROUND_MEASUREMENT`). Live oracle cost and latency, and model cost, are not measured (**NEEDS HUMAN LIVE RUN**). Settlement window, reference age, cooldown, minimum stakes, rounding and spending limits stay **PROPOSED**, not final.
3. Separate bankroll and retired funds from storage, liabilities and reserve; size the finite key allowance with measured headroom. **PARTIAL.** The contract's `life` view already partitions them. `docs/evidence/rehearsal-local-sizing.json` derives a PROPOSED allowance (about 0.88 NEAR at 30 Tgas attached, 1.76 NEAR at the 250 Tgas the service attaches today) and reserve (about 12.2 and 13.3 NEAR) from the local numbers plus assumptions, using recorded earlier testnet oracle charges. Not approved; needs live numbers.
4. Disposable rehearsal of permitted publication, forbidden calls and transfers, no full-access/upgrade path, behaviour at allowance exhaustion. **DONE locally** (`tests/rehearsal-permissions.ts`, `tests/rehearsal-static-audit.ts`). **NEEDS HUMAN LIVE RUN** on a disposable testnet account (`docs/rehearsal/RUNBOOK.md`). Limit: the compiled Wasm imports every promise action host function, so the static audit checks exported methods, contract source and key list, not imports.
5. Operational unavailability shown apart from death; funds neither revive bankroll nor reset allowance; other callers settle and recover. **DONE locally** at the contract level (`tests/rehearsal-permissions.ts`), service (`GET /api/operational`; forecast request refused before inference) and browser (`tests/key-allowance.spec.ts`, `tests/operational-assessment.ts`). Limit: the contract cannot read its key allowance, so its views only show the agent alive; the service reports the cause. A proactive banner before the visitor asks needs a change in `public/` (owned by issue #10).
6. Preserve transaction, code-identity, key-permission, cost and wallet-journey evidence without secrets; bring scope changes back. **PARTIAL.** Local evidence files with provenance (commit, versions, Wasm SHA-256, commands). Live evidence capture is scripted (`scripts/rehearsal/`, logs redacted, key files mode 600) but **NEEDS HUMAN LIVE RUN**. Scope decisions are in `docs/rehearsal/decisions-needed.md`.

## Known gap in the evidence

A mutation check on the contract did not behave as expected. Removing both publication authorization `require!` checks from `publish_prediction`, rebuilding and running `tests/rehearsal-permissions.ts` still passed, and a direct probe showed publication by a non-key caller still failed on the mutant (`.local/runtime/m2-probe.log`, not committed). The cause is unexplained; the next step was building the mutant into a separate target directory and probing it (`.local/chain-mutation3.sh`, never run). So the claim that the permissions test detects removal of the contract-side authorization is **not established**. The network-side checks (forbidden actions rejected for the restricted key, with control keys accepted) and the browser spec (a mutant that skips the preflight fails it) were shown to fail correctly.

## Last verification run (CI order, one chain, all under the shared lock, at commit `fd2ba4b`)

`npm run lint` exit 0; `npm run typecheck` exit 0; `npm run build:contract` exit 0; `npm test` exit 0 (contract, settlement, payment-proof, all new rehearsal tests, Playwright 18 passed); `npm run test:diagnostic-contract` exit 0; `npm run audit:high` exit 0 (low and moderate findings remain, as in the README). Logs: `.local/runtime/f-*.log` (uncommitted, in the worktree). Afterwards only `rehearsal-sizing.ts`, its test and the evidence JSON were regenerated and re-run (sizing test and assembler exit 0); the integration branch tip 89e8111 was merged (docs only).

## Commands to finish and verify what is left

```sh
# Re-run everything in CI order (from the worktree root, one at a time under the heavy lock)
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run lint
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run typecheck
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run build:contract
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm test
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run test:diagnostic-contract
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run audit:high

# Only the new rehearsal checks
./scripts/with-local-env.sh npm run test:rehearsal
./scripts/with-local-env.sh npx playwright test tests/key-allowance.spec.ts

# Regenerate the local evidence files from captured logs (offline)
./scripts/with-local-env.sh npx tsx scripts/rehearsal/assemble-local-evidence.ts \
  --measurement-log <log with REHEARSAL_MEASUREMENT> --complete-round-log <log from tests/settlement-contract.ts> \
  --payment-proof-log <log from tests/payment-reconciliation.ts>
```

To close the mutation gap: copy the mutation approach in the section above (remove the two `require!` blocks at the top of `publish_prediction`), build into a separate `CARGO_TARGET_DIR`, deploy that Wasm with `PROBE_WASM`, publish as a non-key account, and find which check still stops it. If publication then succeeds, strengthen step 1c of `tests/rehearsal-permissions.ts` to assert `active_prediction` is null afterwards; if it fails, find the second guard and document it.

The live rehearsal itself is `docs/rehearsal/RUNBOOK.md` (human-run), with open scope decisions in `docs/rehearsal/decisions-needed.md`.

## Changes outside tests, scripts and docs (for merge planning)

- `service.ts`: `PUBLISH_GAS` and `PUBLICATION_ALLOWANCE` constants, `GET /api/operational`, a publication preflight and rejection mapping, and two `RECKON_TEST`-only endpoints (`/test/publication-key`, `/test/fund-contract`).
- `forecast.ts`: optional `publicationReadiness` on `PredictionChain`, an optional `cause` on the unavailable result, and the preflight before cooldown and inference.
- `package.json`: `test:rehearsal` and `pretest:rehearsal`, and `test:contract` now runs `test:rehearsal`.
- New root modules: `operational.ts`, `rehearsal-audit.ts`, `rehearsal-rpc.ts`, `rehearsal-sizing.ts`. No change to `contract/src/*` and none to `public/`.
- Suggested README lines: add `./scripts/with-local-env.sh npm run test:rehearsal` to the Verify list, and one paragraph noting that `GET /api/operational` reports key allowance, reserve and death separately, that sizing is PROPOSED from local measurements, and pointing to `docs/rehearsal/RUNBOOK.md` and `docs/rehearsal/decisions-needed.md`.
