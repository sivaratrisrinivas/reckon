# Issue #11 verification (2026-11-15 00:57 IST, GS-T71, clean Linux x86-64 box, branch tip cd321d0)

Verified on a fresh clone with no `.env` (Node 26.13.0, Rust 1.95.0, NEAR sandbox 2.14.0, `npm run build:contract` first):

- `npm run demo:local` run A: exit 0, `ASSERTIONS PASSED: 177`, `DEMO RESULT: PASS in 188s of the 600s hard budget`, all three cleanup lines `OK`.
- `npm run demo:local` run B, immediately after: exit 0, 177 passed, PASS in 187s, all three cleanup lines `OK`.
- `npx playwright test tests/demo-local.spec.ts`: 4 passed (3.7 min): live mode refused, startup failure exits non-zero and leaves no data, budget overrun exits non-zero and leaves no process or data, full life to verified death with the UI checks and exit 0 after Ctrl-C.
- `npm run lint` 0, `npm run typecheck` 0.

The text below is the earlier status, kept for history; the "not confirmed" items above are now confirmed.

# Issue #11 status (written 2026-11-15 00:35 IST, at a forced stop)

Branch `worktree-agent-a339859bdc9aaa0fa`, based on and merged with the integration branch tip `89e8111`. Everything is committed.

## Does `npm run demo:local` pass now?

Not demonstrated as a clean standalone pass twice. Honest state:

- Latest code with the six rejection assertions fixed (commit `6f631af`) passed once inside `npm test` (chain 2, `tests/demo-local.spec.ts` test 4): the run reached `HOLDING` with no `FAIL` line in its transcript, and the Playwright page checks of the dead life and the simulation labels passed. That test then failed only on `expect(await run.exited).toBe(0)` (received `null`) because the spec sent SIGINT to the whole npm process group, so npm died by signal. Fixed in `74f65f5` (SIGINT goes to the orchestrator's own pid; the spec also fails fast if the demo exits before `HOLDING`). The fix is not re-verified.
- Standalone runs on the earlier code (`chain2.runA` and `chain2.runB`, before `6f631af`): 171 assertions passed, 6 failed, exit 1, 190 s, cleanup lines all OK. All six failures were the same cause, not behaviour: the sandbox reports a contract `require!` failure as `WebAssembly trap: An unreachable opcode was executed` with no panic text, so the substring checks found nothing. `6f631af` asserts the message when present, otherwise asserts failure plus a named control. This exit-1 run is also the evidence that failed assertions exit non-zero and still clean up.
- A final verification chain (`chain3`: demo twice, lint, typecheck, then the demo spec) was already holding or waiting for the lock when the stop came. Its logs are `/home/srinivas/.cache/rk-demo/chain3.{runA,runB,lint,typecheck,spec}.log` with `chain3.done` at the end. Read them first; they are the missing verification. Nothing else was queued.

Best diagnosis if chain3 shows a failure: a failing line starting `FAIL` names the assertion; every failure is also repeated under `Failed assertions:`. Past failures were all assertion-text mismatches, none were balance or conservation failures.

## Acceptance criteria

1. Build and start the browser, service, sandbox, compiled contract, simulated oracle, scripted model and deterministic signers without credentials: DONE. `scripts/demo-local.ts`, `local-signers.ts`, demo-mode switches in `service.ts`. Startup, bundle build and a whitelisted child environment were exercised in every run; `.env` is never read (`RECKON_DEMO_LOCAL=1`).
2. Label simulated prices, scripted forecasts, accelerated timings and play money in the UI and narration: DONE. Narration banner; `public/app.js` provider label; assertions on the served bundle and page; Playwright page check in the demo spec (passed once, see above). Not re-verified after the last edits.
3. Agent win, challenger win, void refund, recoverable payment failure and death in a bounded run with transaction and account evidence: DONE in the 190 s runs (all five scenarios, 171 passes with tx hashes, receipts and balances). Clean final pass of the standalone command still unconfirmed, see above.
4. Assertions on conservation, beneficiary payments, irreversible death, blocked post-death takes and publication, continued recovery; non-zero exit on failure: DONE for the assertions (exact balance deltas from `view_account`, contract `life` views, conservation against pending liabilities and unsolicited funds). Non-zero exit proven by the exit-1 runs. Caveat: six contract rejections are attributed by control because the node returns a generic trap (see `docs/local-demo.md` Limits).
5. Restricted-key rehearsal and old authority unable to transfer after removal: DONE in the sandbox: the prediction key is rejected for transfer, deploy, add key, delete key, other method, other receiver; after removal exactly one key remains and the old key gets `AccessKeyNotFound` for transfer, deploy, add key. Final live locking is NOT performed or simulated as real.
6. Clean-machine instructions and repeat-run cleanup: PARTIAL. `docs/local-demo.md` is written and matches the observed transcript. Repeat-run cleanup is shown by the three `OK` cleanup lines in each run and the budget/startup failure spec tests (passed: `chain1.fast.log`, and inside chain2's `npm test`). A clean back-to-back pair of passing runs is what chain3 was meant to supply.

## CI-order results (chain 2, before the spec fix)

lint 0, typecheck 0, build:contract 0, `npm test` 20 passed 1 failed (only the exit-code line above; 8.8 minutes for Playwright, contract tests before it), `test:diagnostic-contract` 0, `audit:high` 0.

## Commands to finish and verify (each under the lock)

```sh
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run demo:local        # twice; expect exit 0 and three OK cleanup lines
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npx playwright test tests/demo-local.spec.ts
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run lint
. ./.local/env.sh && flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run typecheck
```

Then the full CI order: lint, typecheck, `npm run build:contract`, `npm test`, `npm run test:diagnostic-contract`, `npm run audit:high`.

## Files other issues probably also touch

`package.json` (one script, `demo:local`), `service.ts` (demo-mode switches), `public/app.js` (one label string). New: `local-signers.ts`, `scripts/demo-local.ts`, `scripts/demo-local-chain.ts`, `tests/demo-local.spec.ts`, `docs/local-demo.md`. `contract/src/*` is untouched. The full-life spec adds about 3.3 minutes to `npm test`; CI's 20-minute limit is a risk, so consider gating that one test if CI runs close to the limit.

## Recommended README lines

- Under Verify: "`./scripts/with-local-env.sh npm run demo:local` runs a credential-free, clearly labelled simulated life ending in verified death; see [docs/local-demo.md](docs/local-demo.md)."
- In the Forecasts section: "The demo's simulated prices, scripted forecasts, accelerated timing and play money never demonstrate live forecasting skill."
