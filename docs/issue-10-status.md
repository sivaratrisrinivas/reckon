# Update 2026-11-15 01:37 IST (GS-T71)

- `npm run measure:experience` ran to completion (1 passed, 1.0 min): `docs/evidence/accessibility-performance.json` now exists. Emulated only (Chromium headless shell 158 on a Linux x86-64 Xeon host; mobile 390x844 at 4x CPU throttling, laptop profile). All targets met in emulation: frame time (0 missed frames on both), worst feedback 9.2 ms mobile and 10.8 ms laptop against 100 ms, layout shift under 0.1 over the measured journey, core JS 21.5 KB gzip / 18.6 KB brotli (target 200), CSS 3.7 KB gzip (target 30), no fonts, whole mobile journey 171,862 bytes transferred over 55 requests (uncompressed loopback). Not a real-device result; see the file's `limitations`.
- State suite: the audit's layout-shift baseline now waits for the sweep's own shifts to settle (8d01087). Remaining failures: phone challenge-open shift 0.128, and the two payment-recovery tests (also fail alone).
- No real screen reader has been run.

# Issue 10 status: accessible, responsive 2D experience

Written when work stopped on the shared usage limit. Branch `worktree-agent-a070ba34563417247`. This file is the source of truth for what is verified. `docs/accessibility-and-performance.md` describes the intended checks and was written before the last test run, so treat its matrix as the design of the checks, not as results.

## What exists

- `public/index.html`, `public/style.css`, `public/app.js`: one visible state label with a shape mark for every state (loading, idle, wallet preparation, thinking, abstained, cancelled, cooldown, unavailable, challenge open, awaiting approval, submitted, accepted, closed, waiting, settling, resolved, payment pending, void, dead); busy and inert controls use `aria-disabled` so focus is kept; the approval dialog focuses its title; Escape cancels; panels the visitor is operating stay in place when an offer ends; repeated renders no longer rewrite live regions; the record list keeps unchanged rows; DESIGN.md colour tokens; fixed-pixel mobile paddings so 200% text fits; one primary action per state (Retry payment or Verify payment receipt outranks Ask Reckon).
- `playwright.experience.config.ts`, `tests/experience/support.ts`, `tests/experience/states.spec.ts` (17 tests), `tests/experience/measure.spec.ts` (emulated mobile and laptop profiles, writes `docs/evidence/accessibility-performance.json`).
- `package.json`: `npm test` now also runs the experience suite; new `test:experience` and `measure:experience`. `playwright.config.ts` ignores `tests/experience`. `tsconfig.json` includes the new config. No change to `service.ts` or `contract/`.

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Restrained futuristic tension across all state layouts, real fixtures | PARTIAL | All states are driven through the real service and sandbox with the `RECKON_TEST` endpoints. Last full run `.local/runtime/exp7.log` (not committed): 13 of 17 passed, including preparation audit, void, resolved, payment failure, window closing, dialog, wallet transaction, parity, reduced motion and death. Fixes for the other four are committed but not re-run. |
| At most one primary action, consent terms visible, stable numbers, evidence disclosures | PARTIAL | One-primary-action is asserted in every audited state and passed in the 13 passing tests. The "consent terms and the action fit one 390 x 844 screen" assertion sits in the challenge-open test, which failed only on layout shift (see below). Evidence is a link plus fingerprint inside the prediction card, not a collapsed disclosure, because existing tests require the download link to be visible. |
| Keyboard, focus visibility and preservation, 200% text, contrast, non-colour cues, status announcements, reduced motion | PARTIAL | Every audited state gets a Tab walk (reach and focus indicator), contrast from computed styles, 200% text at 390 and 1440 px, motion audit. Window-closing focus preservation, dialog title focus, Escape and modal containment passed in exp7. No screen reader was run. |
| Identical essential information and actions across rendering behaviour; 2D without optional assets | DONE (one run) | Parity test passed in exp7: baseline, WebGL unavailable, reduced motion, forced colours, 6x CPU, phone viewport give identical headings, terms, actions and accessibility tree; no canvas, no WebGL context, no extra requests. No 3D exists. |
| Reference profiles, frame time, feedback, layout shift measured | NOT DONE | `measure.spec.ts` is written. One attempt ran the mobile profile and failed at the laptop profile's first-scene check; the spec is fixed but not re-run. `docs/evidence/accessibility-performance.json` does not exist. Control feedback under 4x throttling with 600 ms RPC delay is asserted in the state suite and passed in exp7 (the wallet transaction test). |
| Initial core JS, CSS, fonts and total journey bytes | PARTIAL | Budget test passes (core JS about 20 KB gzip and 17 KB brotli at the first measurement, 54.7 KB raw now; CSS a few KB; no fonts). The whole-journey transfer total and lazy bytes are produced only by the unrun measurement spec. Wallet code is in the core bundle; there is no lazy wallet chunk or optional graphics. |
| No animation blocks consent, fakes activity or treats a submitted transaction as confirmed | DONE (one run) | Only 120 to 240 ms finite transitions; none with reduced motion (test). The wallet transaction test asserts "Challenge submitted" is shown and "accepted on chain" is not, until the contract confirms. |

## Failing or unverified tests

Last full experience run (exp7, before the final fixes) failed these four, each now changed but not re-run:

1. Wallet preparation: the new Tab walk moved focus before the test pressed Enter. Test now re-tabs to Fund local test wallet.
2. Operational unavailability: cascade from the drained wallet after failure 1. `ensureIdle` now tops the wallet up.
3. Challenge open on a phone: header text wrapped after load and shifted the page (layout shift 0.137 against 0.1). Reserved header and status heights were added (`min-height: 2lh` for wallet and provider lines, 6.3em status). Remaining expected shift from the record section is about 0.07, close to the limit.
4. Transfer attempt in flight: pressing Verify can get HTTP 409 because the keeper holds its recovery slot for part of each second. This is a pre-existing server race, load-sensitive. The page now says the recovery was refused and to press again; the test presses again up to six times. Passing alone is not yet shown.

The existing browser suite (17 tests in forecast, life, diagnostic) passed after the first UI changes (`.local/runtime/existing1.log`) and was not re-run after later CSS and payment-message edits. `npm run lint` and `npm run typecheck` last passed before the final edits. `npm run build:contract` ran once at the start. The full `npm test`, `npm run test:diagnostic-contract` and `npm run audit:high` were never run on this branch. The integration tip 89e8111 is merged (docs only).

## Commands to finish, each under the heavy lock

```sh
. ./.local/env.sh
flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npx playwright test -c playwright.experience.config.ts --reporter=line
flock "$HEAVY_LOCK" ./scripts/with-local-env.sh npm run measure:experience
flock "$HEAVY_LOCK" ./scripts/with-local-env.sh sh .local/final-a11y.sh   # lint, typecheck, build:contract, npm test, test:diagnostic-contract, audit:high; summary in .local/runtime/final-summary.log
```

Then copy the numbers from `docs/evidence/accessibility-performance.json` into `docs/accessibility-and-performance.md`, commit the JSON and the document with explicit paths, and merge the current integration tip again. Report any measured target miss as a miss. If the layout-shift test still fails near 0.1, raise `.forecast` `min-height` or reserve more status height rather than raising the limit.

## Not covered

No screen reader (VoiceOver, TalkBack, NVDA) was used. Text size is emulated by scaling the root font size. No real phone or laptop was measured; all numbers will be emulated Chromium headless shell results. Contrast is computed for the dark theme only.

## Recommended README lines

Under Verify: `./scripts/with-local-env.sh npm run test:experience` (state, keyboard, focus, contrast and 200% text audit) and `./scripts/with-local-env.sh npm run measure:experience` (emulated mobile and laptop measurements, writes `docs/evidence/accessibility-performance.json`), with a pointer to `docs/accessibility-and-performance.md`.
