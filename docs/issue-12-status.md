# Issue #12 status: rehearsal with measured permissions and reserves

Branch `worktree-agent-a1c7086882fffc7e3`. Nothing live was run: no testnet transaction, no paid oracle call, no model call, no deployment, no `.env` read, no spending. Every measurement is from the production Wasm on the local sandbox with a fixture oracle ("local sandbox with fixture oracle, not live"). No live criterion is met.

## Acceptance criteria

1. Real market evidence, authenticated model inference, actual wallet, paid oracle refresh and callback, real challenger payout. **NEEDS HUMAN LIVE RUN, and cannot run with current code:** the service has no testnet mode and the browser uses an ephemeral sandbox signer (`docs/rehearsal/decisions-needed.md`, item 2). Scripts under `scripts/rehearsal/` prepare the contract-level part only (oracle, callback, gas, storage); they have never been executed.
2. Measure growth, storage, publication gas, oracle, settlement, recovery, model costs; finalize settings. **PARTIAL.** Local numbers recorded in `docs/evidence/rehearsal-local-measurements.json` (record growth about 593 bytes per prediction, gas for publication, take, settlement, void, retry; reconciliation figures reused from `PAYMENT_PROOF_MEASUREMENT`, the round figures from `COMPLETE_ROUND_MEASUREMENT`). Live oracle cost and latency, and model cost, are not measured (**NEEDS HUMAN LIVE RUN**). Settlement window, reference age, cooldown, minimum stakes, rounding and spending limits stay **PROPOSED**, not final.
3. Separate bankroll and retired funds from storage, liabilities and reserve; size the finite key allowance with measured headroom. **PARTIAL.** The contract's `life` view already partitions them. `docs/evidence/rehearsal-local-sizing.json` derives a PROPOSED allowance (about 0.88 NEAR at 30 Tgas attached, 1.76 NEAR at the 250 Tgas the service attaches today) and reserve (about 12.2 and 13.3 NEAR) from the local numbers plus assumptions, using recorded earlier testnet oracle charges. Not approved; needs live numbers.
4. Disposable rehearsal of permitted publication, forbidden calls and transfers, no full-access/upgrade path, behaviour at allowance exhaustion. **DONE locally** (`tests/rehearsal-permissions.ts`, `tests/rehearsal-static-audit.ts`). **NEEDS HUMAN LIVE RUN** on a disposable testnet account (`docs/rehearsal/RUNBOOK.md`). Limit: the compiled Wasm imports every promise action host function, so the static audit checks exported methods, contract source and key list, not imports.
5. Operational unavailability shown apart from death; funds neither revive bankroll nor reset allowance; other callers settle and recover. **DONE locally** at the contract level (`tests/rehearsal-permissions.ts`), service (`GET /api/operational`; forecast request refused before inference) and browser (`tests/key-allowance.spec.ts`, `tests/operational-assessment.ts`). Limit: the contract cannot read its key allowance, so its views only show the agent alive; the service reports the cause. A proactive banner before the visitor asks needs a change in `public/` (owned by issue #10).
6. Preserve transaction, code-identity, key-permission, cost and wallet-journey evidence without secrets; bring scope changes back. **PARTIAL.** Local evidence files with provenance (commit, versions, Wasm SHA-256, commands). Live evidence capture is scripted (`scripts/rehearsal/`, logs redacted, key files mode 600) but **NEEDS HUMAN LIVE RUN**. Scope decisions are in `docs/rehearsal/decisions-needed.md`.

## Mutation gap: resolved (2026-11-15, GS-T71)

The earlier report that `tests/rehearsal-permissions.ts` still passed with both publication `require!` guards removed did not reproduce. Built correctly from a copy of `contract/` into its own target directory (never `contract/target`, which `build:contract` and `check-local.sh` own), the mutant is caught: step 1c fails with "a different caller cannot publish". The earlier result was most likely a mutant that was never actually deployed (rebuilt into, then overwritten in, the shared target directory); the unpreserved logs cannot confirm which.

A real weakness remained: step 1c only caught the removal of BOTH guards, because either guard alone refuses a call signed by another account with another key. Added to step 1c:

- the account's own full-access key calling `publish_prediction` directly (only the signer-key guard refuses it);
- another account signing with the prediction key itself (only the direct-caller guard refuses it);
- `active_prediction` stays null after each refusal, and a positive control publishes with the real key on the same account.

`scripts/rehearsal/mutation-check.sh` (`npm run test:rehearsal-mutation`, about 3.5 minutes, not in CI) builds three mutants (caller guard removed, key guard removed, both removed), refuses a mutant whose Wasm equals production, and requires the test to fail on a guard assertion, not an unrelated error. Result on this branch: production passes; all three mutants caught (caller: "the prediction key must not publish through another account"; key: "a key other than the prediction key must not publish"; both: "a different caller cannot publish").

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
