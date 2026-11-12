# Reckon implementation tickets

Published from the approved breakdown as ready-for-agent children of [specification #1](https://github.com/sivaratrisrinivas/reckon/issues/1). Native GitHub blocking relationships are authoritative. The specification title, body, labels, and open state were preserved.

## Published slices

### T01: [See a living Reckon on a real local chain](https://github.com/sivaratrisrinivas/reckon/issues/2)

Blocked by: None; can start immediately.

Start the application locally and see an initialized agent, its real bankroll, and a time-correct life meter in the approved minimal 2D scene.

Acceptance criteria:

- [ ] Install or document a working Linux Rust, NEAR, Node, and package-manager toolchain with reproducible versions; a fresh checkout can build and run the local browser, service, and compiled contract together.
- [ ] Initialize the contract once on a real NEAR sandbox with usable bankroll and a separate operational reserve. Show test-money status, effective spendable funds, retired funds, and remaining life from authoritative state.
- [ ] Apply the approved matte-graphite, readable, single-primary-action layout from the start. Do not make optional 3D or wallet initialization a prerequisite for reading life.
- [ ] Accrue upkeep at the configured fifteen-day live idle rate with accelerated local settings clearly labelled. Inactivity and repeated small calls cannot bypass fractional upkeep; views project elapsed costs.
- [ ] A browser acceptance scenario advances sandbox time and observes the real balance partition and life estimate. Direct contract checks reject initialization twice and demonstrate that plain transfers do not increase usable bankroll.
- [ ] Provide truthful startup and action-to-result instructions, dependency and AI-assistance disclosures as they become applicable, and a license. No real predictions or public staking are advertised as available yet.

Specification stories: 1, 2, 3, 4, 5, 48, 49, 50, 56, 75, 76.

### T02: [Prove live model and oracle observations before betting](https://github.com/sivaratrisrinivas/reckon/issues/3)

Blocked by: [See a living Reckon on a real local chain](https://github.com/sivaratrisrinivas/reckon/issues/2).

Use a narrow browser-visible diagnostic to observe real market evidence, an authenticated structured model forecast, and an on-chain paid oracle refresh and callback on a replaceable testnet account.

Acceptance criteria:

- [ ] Collect recent completed NEAR-USD candles from a verified public source and a valid reference from the intended settlement provider; preserve provider identities, fetch times, observation times, and any price differences.
- [ ] Make one real authenticated model call using market data and the exact binary question and settlement rules. Verify structured-output behavior, abstention, model identity, latency, and cost without exposing credentials.
- [ ] From a scratch integration contract or the minimal agent integration, pay for a stale-price refresh and receive its actual callback on testnet. Record receipts, returned asset and units, freshness semantics, elapsed time, and actual cost.
- [ ] Demonstrate malformed, stale, null, failed, or excessively delayed observations being rejected or reported unavailable. Do not treat the callback execution timestamp as proof of external market observation time.
- [ ] The diagnostic presents probe status and evidence as technical verification, not as an unlocked public wager or production-ready forecast.
- [ ] Document compatible dependency versions and measured constraints for settlement-window and reserve sizing. If live pricing, inference, or the approved trust model cannot work, report the specific blocker for a scope decision rather than substituting another prediction subject.

Specification stories: 14, 16, 31, 32, 45, 54, 73, 78.

### T03: [Ask Reckon for one inspectable, immutable prediction](https://github.com/sivaratrisrinivas/reckon/issues/4)

Blocked by: [Prove live model and oracle observations before betting](https://github.com/sivaratrisrinivas/reckon/issues/3).

Request a forecast through the application and see the actual model choice, fixed terms, deadlines, and downloadable evidence tied to a real on-chain prediction.

Acceptance criteria:

- [ ] When idle, one request collects validated recent market evidence and the declared reference, invokes the configured model, and publishes yes or no and confidence through the authorized prediction key. Equality is defined as no.
- [ ] Abstention, unavailable inference, invalid output, stale evidence, or an invalid reference creates no prediction. Never clip confidence, invent a forecast, or silently use a template in live mode.
- [ ] Code generates immutable terms with a five-minute horizon and thirty-second challenge window beginning at publication. Fair odds have no house margin; documented integer bounds, smallest-unit rounding, minimum amounts, and the 2% risk cap are enforced on-chain.
- [ ] Size the fixed quote with upkeep headroom for a normally timely take. The model cannot select arbitrary questions, stakes, deadlines, or executable actions.
- [ ] One unresolved prediction is enforced on-chain. Concurrent requests share the active operation or receive a busy response; cooldowns and bounded operational spending prevent request amplification.
- [ ] Publish a durable canonical evidence snapshot and short justification before committing its fingerprint on-chain. Visitors can download it and detect later edits without a wallet; do not claim the fingerprint proves inference execution.
- [ ] The browser shows thinking, abstention, unavailable, and published states in the approved visual language. Local browser-to-sandbox tests use explicitly labelled deterministic external providers while exercising the real publication contract.

Specification stories: 6, 12, 13, 14, 15, 16, 17, 18, 20, 22, 44, 45, 46, 47.

### T04: [Challenge the prediction from a ready wallet](https://github.com/sivaratrisrinivas/reckon/issues/5)

Blocked by: [Ask Reckon for one inspectable, immutable prediction](https://github.com/sivaratrisrinivas/reckon/issues/4).

A connected, funded challenger approves the quoted stake in the browser and sees the one available position become authoritatively accepted.

Acceptance criteria:

- [ ] Before approval, show the exact required test-NEAR stake, potential total return, side, confidence, closing time, network, risk of losing, and the bounded settlement observation rule. Consent-critical terms do not require disclosure clicks.
- [ ] The wallet transaction attaches the exact stake. The contract rechecks availability, deadline, effective upkeep and stake cap, and sufficient funds before recording one challenger and committing the agent stake.
- [ ] Reject unauthorized publication, a second take, late arrival, wrong deposit, the agent taking its own side, or a second unresolved prediction. Any invalid incoming funds follow safe rejection or refund behavior.
- [ ] Distinguish wallet approval, submission, and confirmed acceptance using actual transaction results. Prevent duplicate local submissions and clearly explain a lost race or expired quote without resetting the deadline.
- [ ] The connected-funded path uses Request and Challenge as its two Reckon-controlled clicks, with external signature interactions counted separately.
- [ ] Browser acceptance uses a real local signer and sandbox balances. This incremental slice remains local or rehearsal-only until settlement and payment safety gates pass.

Specification stories: 19, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 57, 58.

### T05: [Resolve the round and pay or refund the challenger](https://github.com/sivaratrisrinivas/reckon/issues/6)

Blocked by: [Challenge the prediction from a ready wallet](https://github.com/sivaratrisrinivas/reckon/issues/5).

Watch a challenged or unchallenged round resolve automatically against the oracle, with the actual winner paid or a missing-data round voided and refunded.

Acceptance criteria:

- [ ] The keeper requests the declared oracle only after the deadline, using the measured bounded completion window. Resolve using the first successful valid request; the browser shows pending observation rather than an exact-expiry claim.
- [ ] Validate provider, asset, response shape, units, usable price, documented freshness semantics, and the request identity. Serialize observations so concurrent settlement attempts cannot choose between outcomes.
- [ ] Cover yes, no, and equality resolving to no. On an agent win, release its commitment and credit the challenger stake subject to death rules; on a challenger win, return both stakes to the original beneficiary.
- [ ] If no valid observation arrives in time, permit safe voiding, refund the challenger, and release the agent commitment. A stalled request cannot make custody permanently unrecoverable.
- [ ] Resolve unchallenged predictions without betting transfers. The browser public record includes all published results, counts valid outcomes independently of participation, excludes voids from accuracy, and supports bounded pagination.
- [ ] Record payment liabilities before asynchronous transfers and show payment pending until receipt success. This ticket supplies successful payout and refund paths; exhaustive failure recovery is completed by the recovery ticket.
- [ ] Browser-to-sandbox scenarios show real outcome receipts, balance changes, no result-reveal click, and correct behavior after reload. Publish storage, oracle, and gas measurements from a complete round.

Specification stories: 28, 29, 31, 32, 33, 34, 35, 36, 37, 39, 41, 42, 43, 44, 51, 73.

### T06: [Recover failed payments and delayed settlement safely](https://github.com/sivaratrisrinivas/reckon/issues/7)

Blocked by: [Resolve the round and pay or refund the challenger](https://github.com/sivaratrisrinivas/reckon/issues/6).

A participant can see and recover an owed payout or refund after failures, while retries and late callbacks cannot pay twice or change a final result.

Acceptance criteria:

- [ ] Failed winner payments and void refunds remain liabilities to their original beneficiaries. Provide an idempotent retry or claim path that cannot redirect funds and is reflected by the browser.
- [ ] Distinguish a failed observation from a failed transfer after a valid outcome. An outcome may be final while payment is still pending; the UI never announces paid until confirmed.
- [ ] Use request and payment identities to ignore or safely reject duplicate, late, forged, mismatched, timed-out, and reordered callbacks. An already voided or terminal prediction cannot be resurrected.
- [ ] Observe conservation against actual balances and measured storage and gas needs throughout pending transfers, failed transfers, refunds, and retries. Do not drop custody obligations from accounting.
- [ ] Automatic recovery where safe and an explicit recovery action where needed preserve the existing obligation without creating a new wager.
- [ ] Exercise failures through the running application plus direct public-contract adversarial tests. Demonstrate repeated recovery calls and concurrent attempts cannot duplicate or redirect any payment.

Specification stories: 24, 34, 37, 38, 39, 40, 54, 68.

### T07: [Make death permanent without abandoning existing rounds](https://github.com/sivaratrisrinivas/reckon/issues/8)

Blocked by: [Resolve the round and pay or refund the challenger](https://github.com/sivaratrisrinivas/reckon/issues/6).

See accelerated local upkeep kill Reckon permanently while an existing prediction still settles and its funds remain protected.

Acceptance criteria:

- [ ] Depletion irreversibly prohibits new predictions and challenges. Project accurate current life before a keeper transaction and persist the death transition safely on successful mutations.
- [ ] Test frequent calls and fractional accrual, depletion before a take or outcome credit, rejected-action rollback, and commitment release after death. None can avoid upkeep or permit revival.
- [ ] Plain transfers, late wins, and unlocked commitments never restore publication or staking ability. Retired funds never become usable bankroll or a sink payment.
- [ ] Settle existing predictions and preserve winner and refund obligations after death. Later integration with the recovery ticket must retain these rights for failed payments.
- [ ] The browser presents dead Reckon with its date and final record, removes new-forecast and challenge actions, and keeps evidence and existing outcomes readable.
- [ ] Both browser acceptance and public-contract tests use real sandbox time and balances; a static frontend dead screen is insufficient evidence.

Specification stories: 40, 48, 49, 50, 51, 52, 53, 55, 68.

### T08: [Prepare a newcomer wallet and challenge within three app clicks](https://github.com/sivaratrisrinivas/reckon/issues/9)

Blocked by: [Resolve the round and pay or refund the challenger](https://github.com/sivaratrisrinivas/reckon/issues/6).

A disconnected or unfunded visitor can prepare a testnet wallet before the forecast and continue into a challenge without a restart or extra Continue screen.

Acceptance criteria:

- [ ] Ask Reckon initiates wallet preparation directly for the challenge path and explains that no stake moves until explicit approval. Validate the network and available funds before inference and publication.
- [ ] Provide the funding route when necessary, recheck readiness on return, and automatically resume only the still-active request. Cancellation, stale reloads, and expired requests cannot unexpectedly launch a forecast.
- [ ] Preserve a quiet wallet-free watch path and wallet-free viewing of current and historical predictions. Existing open rounds still obey the global deadline and first accepted challenger rule.
- [ ] Demonstrate no more than two Reckon-controlled clicks for ready or disconnected-funded wallets and three when a funding link is needed. Record external wallet and faucet actions and elapsed time separately.
- [ ] No preparation or inference step consumes the published thirty-second window. No requester receives a reserved slot, and the interface never extends chain deadlines locally.
- [ ] Browser journeys cover new arrival, wallet rejection, wrong network, insufficient funds, return from funding, lost challenger race, reload, and the automatic result. Count extra recovery clicks honestly instead of relabelling those as successful first attempts.

Specification stories: 7, 8, 9, 10, 11, 12, 22, 25, 28, 29, 30, 56, 57, 58.

### T09: [Verify an accessible, responsive 2D experience in every state](https://github.com/sivaratrisrinivas/reckon/issues/10)

Blocked by: [Recover failed payments and delayed settlement safely](https://github.com/sivaratrisrinivas/reckon/issues/7), [Make death permanent without abandoning existing rounds](https://github.com/sivaratrisrinivas/reckon/issues/8), [Prepare a newcomer wallet and challenge within three app clicks](https://github.com/sivaratrisrinivas/reckon/issues/9).

Use the complete challenge experience on mobile, with keyboard or assistive technology, and on lower-quality devices without losing information or adding interaction steps.

Acceptance criteria:

- [ ] Apply the approved restrained futuristic tension across preparation, thinking, abstention, challenge, waiting, settlement, result, failure, operationally unavailable, and dead layouts, using real state fixtures at external boundaries.
- [ ] Keep at most one primary action per state, none where automatic progress needs no action, readable consent-critical terms, stable numerical layout, and useful secondary evidence disclosures.
- [ ] Verify keyboard-only operation, focus visibility and preservation, 200% text size, contrast, non-color outcome cues, screen-reader status behavior without countdown spam, and reduced motion.
- [ ] Provide identical essential information and actions across high, medium, and low rendering behavior. A conservative 2D experience works without optional assets or WebGL; do not introduce mandatory 3D or a graphics-setup screen.
- [ ] Define reference mid-range mobile and laptop profiles and measure active frame times against 60 fps, local feedback against 100 ms, and layout shift against 0.1. Report device and browser details, missed frames, and limitations honestly.
- [ ] Measure initial compressed core JS, CSS, and fonts against the 200 KB, 30 KB, and 100 KB targets, and report lazy wallet or optional graphics bytes and the whole journey total. Remove unnecessary effects before weakening the targets.
- [ ] No animation blocks consent or completion, fakes activity, or treats a submitted transaction as a confirmed result. Optional 3D remains out unless it independently earns its purpose and passes the same functional and performance checks.

Specification stories: 1, 2, 3, 4, 5, 19, 26, 28, 54, 55, 56, 57, 59, 60, 61, 62, 63, 64, 65.

### T10: [Run a credential-free local life ending in verified death](https://github.com/sivaratrisrinivas/reckon/issues/11)

Blocked by: [Recover failed payments and delayed settlement safely](https://github.com/sivaratrisrinivas/reckon/issues/7), [Make death permanent without abandoning existing rounds](https://github.com/sivaratrisrinivas/reckon/issues/8), [Prepare a newcomer wallet and challenge within three app clicks](https://github.com/sivaratrisrinivas/reckon/issues/9).

A reviewer runs one command from a clean environment and watches a clearly labelled simulated life with real contract payments, restrictions, and irreversible death.

Acceptance criteria:

- [ ] Build and start the browser, actual service, real sandbox, compiled agent contract, simulated oracle, scripted model fixture, and deterministic local signers without personal credentials, live accounts, or paid inference.
- [ ] Clearly label simulated prices, scripted forecasts, accelerated timings, and play money throughout the local UI and narrated output. Do not imply the scenario demonstrates live model forecasting skill.
- [ ] Complete at least an agent win, challenger win, void refund, recoverable payment failure, and death within a bounded deterministic run. Show actual transaction and account evidence.
- [ ] Assert money conservation, correct beneficiary payments, irreversible death, blocked post-death takes and publication, and continued existing-obligation recovery. Failed assertions or startup failures exit unsuccessfully.
- [ ] Rehearse the restricted-key permissions in the disposable sandbox and demonstrate that the old authority cannot make a transfer after its removal; final live locking remains a separate approval-gated action.
- [ ] Clean-machine instructions state prerequisites and exact observable results. Repeat the run to verify bounded completion and cleanup without making live provider availability a dependency.

Specification stories: 40, 52, 53, 66, 67, 68, 69, 75.

### T11: [Rehearse a complete live round with measured permissions and reserves](https://github.com/sivaratrisrinivas/reckon/issues/12)

Blocked by: [Recover failed payments and delayed settlement safely](https://github.com/sivaratrisrinivas/reckon/issues/7), [Make death permanent without abandoning existing rounds](https://github.com/sivaratrisrinivas/reckon/issues/8), [Prepare a newcomer wallet and challenge within three app clicks](https://github.com/sivaratrisrinivas/reckon/issues/9).

Complete the real browser-to-testnet forecast, challenge, oracle settlement, and payout on a replaceable rehearsal account, and prove the eventual restricted key and operational budget.

Acceptance criteria:

- [ ] Use real market evidence, authenticated model inference, the actual wallet, and the paid oracle refresh and callback established by the feasibility probe. A real challenger receives the promised result or correctly handled refund.
- [ ] Measure actual record growth, storage cost, publication gas, oracle refresh, settlement, recovery, and model costs; finalize documented settlement-window, reference-age, cooldown, minimum-stake, rounding, and spending-limit settings.
- [ ] Separate usable bankroll and retired funds from storage, pending liabilities, and an operational reserve. Size the finite publication-key allowance with measured headroom rather than assuming unlimited gas or faucet funding.
- [ ] In a disposable rehearsal, verify the permitted publication call, forbidden transfer and method calls, no full-access recovery or upgrade path in deployed code, and safe behavior when the key allowance is exhausted.
- [ ] Show operational unavailability separately from bankroll death; adding funds must not revive usable bankroll or reset key allowance. Other callers must still settle and recover obligations when publication is unavailable.
- [ ] Preserve transaction, code-identity, key-permission, cost, and live wallet-journey evidence without committing secrets. Bring any required product or trust-model change back for an explicit scope decision.

Specification stories: 14, 16, 24, 25, 26, 31, 32, 34, 35, 36, 38, 40, 47, 53, 54, 69, 70, 71, 72, 73, 78.

### T12: [Launch the verified agent and prepare the submission handoff](https://github.com/sivaratrisrinivas/reckon/issues/13)

Blocked by: [Verify an accessible, responsive 2D experience in every state](https://github.com/sivaratrisrinivas/reckon/issues/10), [Run a credential-free local life ending in verified death](https://github.com/sivaratrisrinivas/reckon/issues/11), [Rehearse a complete live round with measured permissions and reserves](https://github.com/sivaratrisrinivas/reckon/issues/12).

Host the verified final testnet experience and durable evidence, complete the explicitly approved irreversible lock, and provide a truthful demo and submission package.

Acceptance criteria:

- [ ] Run the final complete acceptance and adversarial suites against the release candidate; verify the README claims against the actual browser and clean local demonstration before using an immutable final account.
- [ ] Deploy and initialize the final directly held contract with measured immutable settings. Verify the restricted prediction key and its finite allowance before presenting the exact account and irreversible action for explicit human approval. Stop before deletion until that approval arrives.
- [ ] After approval, remove full-access keys, verify only the intended restricted publication key remains, preserve deployed-code and key evidence, and demonstrate failed authority using the old key. No owner withdrawal, upgrade, or administrative recovery path exists.
- [ ] Host browser, service, and downloadable evidence reliably through judging, ideally through 25 November, with secrets in secure configuration. Verify public links, phone layout, and one live complete moment after final deployment.
- [ ] Provide a truthful README, license, dependencies and AI-assistance disclosures, operational and trust limitations, real-versus-simulated labels, and public repository readiness. Any repository visibility change or push requires the applicable authorization.
- [ ] Record a full backup demonstration before final polish and prepare the final video and X-post text. The human publishes the post and supplies its URL; the app link and repository link are valid.
- [ ] Read the live event rules again and prepare the exact validated submission payload with the real supplied identity, email, mainnet payout account, chosen tracks, and consent. Obtain explicit payload confirmation before the single submission; never invent personal values or submit a duplicate.
- [ ] Reserve the final six working hours for verification and submission, target 14 November at 22:00 IST, and keep the official 15 November 05:29 IST deadline explicit. Human-gated actions are not complete merely because drafts exist.

Specification stories: 47, 54, 55, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78.

## Verification

Verified all 12 child relationships, all 19 native blocking edges, complete issue bodies, open child states, and ready-for-agent labels. The parent specification contents and state match the pre-publication snapshot. All 78 specification stories are covered.

The first available ticket is [See a living Reckon on a real local chain](https://github.com/sivaratrisrinivas/reckon/issues/2). No implementation has started as part of ticket publication.
