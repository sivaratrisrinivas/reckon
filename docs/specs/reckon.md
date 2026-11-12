# Reckon: an AI that stakes its predictions and can permanently die

## Problem Statement

People encounter confident AI predictions without a reliable way to inspect the evidence or make the predictor bear the consequences of being wrong. Confidence is easy to state and difficult to evaluate, while complex crypto interfaces make even a small accountability experiment inaccessible to newcomers.

Reckon makes that consequence visible through a single agent with a finite test-money bankroll, inspectable predictions, enforceable stakes, and permanent death. Its goal is a reproducible, playable experiment in model judgment and confidence, not a claim that a contract can prove a model's beliefs are honest or its forecasts accurate.

## Solution

A visitor requests a forecast from Reckon. Given recent NEAR market data and the exact rules, an AI model chooses a side and confidence, or abstains, on one question: will the settlement price of NEAR/USD be strictly above a fixed reference price? The code fixes fair odds and a stake capped at 2% of spendable bankroll. One challenger may take the opposing side during the first thirty seconds. The prediction reaches its deadline five minutes after publication and resolves using the agreed bounded settlement-time observation rule. An unchanged price means the answer is no.

The correct party receives the stakes. Unchallenged predictions also receive outcomes and enter the accuracy record. Missing valid settlement data produces a void and refunds the challenger. Configured upkeep permanently retires usable bankroll. The initial rate gives fifteen days of idle life before betting results; when spendable funds run out, death permanently prevents new predictions and challenges while preserving existing obligations.

The browser experience uses restrained futuristic tension, one current prediction, at most one primary action per state, and no more than three Reckon-controlled clicks along successful staking paths. Wallet steps are counted separately. A public testnet experience demonstrates real market forecasts; a separately labelled local simulation reproducibly demonstrates the complete lifecycle, payments, permission restrictions, and death.

## User Stories

1. As a first-time visitor, I want to understand within two seconds that this AI pays when wrong, so that I know why the experiment matters.
2. As a visitor, I want to see Reckon's remaining life immediately, so that its finite resources are tangible.
3. As a visitor, I want to see the testnet and play-money status before acting, so that I understand the funds involved.
4. As a visitor, I want to inspect the current prediction and recent record without connecting a wallet, so that I can evaluate Reckon first.
5. As a visitor, I want one obvious primary action for the current state, so that I do not have to choose among competing controls.
6. As a prospective challenger, I want to request a forecast when Reckon is idle, so that I can start a round when I am ready.
7. As a prospective challenger, I want wallet preparation to finish before my requested prediction is published, so that preparation does not consume its challenge window.
8. As a visitor with an existing funded wallet, I want connection to begin directly from the request action, so that I avoid an unnecessary application step.
9. As a visitor without test funds, I want a clear funding route and a readiness check on return, so that I can continue without restarting the flow.
10. As a visitor returning from wallet preparation, I want my still-active request to continue automatically, so that I do not have to click Continue again.
11. As a visitor who cancels preparation, I want the request to stop, so that a later navigation does not unexpectedly publish a prediction on my behalf.
12. As a spectator, I want to request a forecast without a wallet through a secondary watch path, so that participation does not require staking.
13. As a user, I want the interface to say when another request is already in progress, so that concurrent visitors do not trigger duplicate inference or publication.
14. As a user, I want useful cooldown and availability feedback, so that I can distinguish rate limiting from a broken application.
15. As a visitor, I want the AI to be allowed to abstain, so that the interface does not force it to invent confidence.
16. As a visitor, I want unavailable inference to produce no new prediction, so that a hidden template or statistical substitute is not presented as model judgment.
17. As a visitor, I want the same understandable binary question every round, so that I do not have to interpret arbitrary claims.
18. As a visitor, I want the reference price, side, confidence, and deadlines fixed at publication, so that terms cannot change after I decide.
19. As a challenger, I want the exact required stake and potential total return visible before approval, so that I can give informed consent.
20. As a challenger, I want fair odds derived from the quoted confidence without a house margin, so that I can understand the wager.
21. As a challenger, I want exactly one accepted challenger per prediction, so that the available position is unambiguous.
22. As a visitor, I want to know that requesting a forecast does not reserve its challenger slot, so that I understand another participant may take it first.
23. As a challenger, I want my deposit accepted only while the slot and deadline permit, so that the contract enforces the displayed rules.
24. As a challenger, I want rejection or refund if my transaction arrives too late or loses a race, so that I do not fund an invalid position.
25. As a challenger, I want an explicit wallet approval before staking, so that a forecast request never commits my funds.
26. As a challenger, I want the app to distinguish signing, submission, and confirmed acceptance, so that I do not mistake a transaction hash for a secured position.
27. As a challenger, I want duplicate submission prevented during pending approval, so that repeated clicks do not create unintended actions.
28. As a participant, I want the result to appear automatically without another reveal click, so that the flow reaches its actual objective.
29. As a participant, I want to leave and return to my prediction without reconnecting merely to read it, so that a five-minute round does not require constant attention.
30. As a late visitor, I want a closed or taken challenge to switch clearly into spectator status, so that I do not keep trying an unavailable action.
31. As a participant, I want the settlement observation rule visible before staking, so that I know it is not a historical exact-expiry price.
32. As a participant, I want caller timing and provider caching limitations disclosed, so that automatic settlement is not misrepresented as perfect measurement.
33. As a participant, I want an unchanged settlement price to resolve to no, so that valid observations always have one winning side.
34. As a participant, I want a successful settlement to pay the correct party exactly once, so that retries cannot duplicate payments.
35. As a winning challenger, I want my original stake and the agent's stake returned together, so that the promised total return is honored.
36. As a participant, I want a void when valid data does not arrive within the allowed window, so that missing data does not choose a winner.
37. As a challenger in a voided round, I want my stake refunded and the agent's commitment released, so that neither side wins from unavailable data.
38. As a participant, I want failed payouts to remain visible and recoverable, so that a recorded outcome cannot hide an unpaid obligation.
39. As a participant, I want stale or duplicate oracle callbacks rejected safely, so that delayed asynchronous work cannot change a final result.
40. As a participant, I want settlement to continue after the agent dies or loses publication ability, so that my existing position is protected.
41. As a spectator, I want every published prediction resolved where valid data exists, so that the record is not selected by challengers' participation.
42. As a spectator, I want voids excluded from accuracy, so that missing outcomes do not inflate or reduce apparent forecasting skill.
43. As a spectator, I want unchallenged predictions to affect accuracy without moving betting funds, so that recordkeeping and payments stay distinct.
44. As a skeptic, I want immutable terms and outcomes, so that the agent cannot delete its misses or rewrite its promises.
45. As a skeptic, I want downloadable evidence, model identity, structured output, and a short justification, so that I can inspect what the forecast was based on.
46. As a skeptic, I want to compare the evidence fingerprint against the on-chain record, so that I can detect changes to the published evidence.
47. As a skeptic, I want evidence-hosting and off-chain-inference limits stated honestly, so that a fingerprint is not mistaken for proof of computation or guaranteed availability.
48. As a visitor, I want the life meter to reflect elapsed upkeep even without recent transactions, so that inactivity does not make the agent appear immortal.
49. As a visitor, I want upkeep described as a configured rule, so that I do not mistake it for actual AI invoices.
50. As a visitor, I want retired bankroll distinguished from burned tokens and spendable funds, so that the account's physical balance is not misleading.
51. As a visitor, I want betting wins and losses to change the remaining-life estimate visibly, so that outcomes have an understandable consequence.
52. As a participant, I want permanently dead Reckon to reject new predictions and challenges, so that death has enforceable meaning.
53. As a skeptic, I want late winnings and unsolicited transfers unable to revive Reckon, so that the builder cannot rescue the usable bankroll.
54. As a visitor, I want operational unavailability distinguished from death, so that unavailable inference or an exhausted key is not presented as economic failure.
55. As a visitor, I want the dead agent's final record to remain accessible, so that its history survives its activity.
56. As a mobile user, I want essential terms and the action legible together, so that I can participate without navigating a dashboard.
57. As a user, I want successful staking paths to take at most three Reckon-controlled clicks, so that interaction overhead stays low.
58. As a user, I want wallet interactions and recovery clicks counted honestly, so that the click target is not met by hiding work.
59. As a keyboard user, I want clear focus and complete operation without pointer gestures, so that I can use every essential function.
60. As a user with low vision, I want sufficient contrast and 200% text enlargement without losing controls, so that the experience remains readable.
61. As a user with color-vision differences, I want text and shape to accompany state colors, so that outcomes never depend on color alone.
62. As a screen-reader user, I want useful status announcements without countdown spam or unexpected focus changes, so that I can understand a round.
63. As a user sensitive to motion, I want reduced-motion and static equivalents, so that visual effects do not block participation.
64. As a user on a mid-range device, I want responsive controls and smooth active transitions, so that the visual direction does not compromise usability.
65. As a user whose device cannot run optional 3D, I want the same information and actions in 2D, so that graphics support is never a prerequisite.
66. As a reviewer, I want one reproducible local demonstration without personal keys or paid inference, so that I can verify the claimed behavior.
67. As a reviewer, I want local simulated prices and scripted model outputs labelled, so that I can distinguish lifecycle verification from live forecasting skill.
68. As a reviewer, I want the local run to assert payments, restrictions, conservation, and death and fail on violations, so that a narrated log is not accepted as proof.
69. As a builder, I want a rehearsal account and tested permissions before the final lock, so that irreversible deployment follows demonstrated behavior.
70. As a builder, I want the final account to have no full-access key or administrative recovery method, so that I cannot arbitrarily withdraw funds or replace its rules.
71. As a builder, I want a measured finite gas allowance for the prediction key, so that malfunction or compromise has a bounded gas cost.
72. As a builder, I want the app to stop requesting forecasts when operational prerequisites cannot be met, so that it does not accept obligations it cannot support.
73. As a builder, I want measured storage, oracle, gas, and inference requirements before immutable configuration, so that reserve sizing is evidence-based.
74. As a builder, I want explicit approval before final key deletion, so that the irreversible step remains a deliberate action.
75. As a judge, I want truthful instructions connecting an action to an observable result, so that I can reproduce the entry without private context.
76. As a builder, I want a public repository with a license and dependency and AI-assistance disclosures, so that the submission meets the event requirements.
77. As a builder, I want a recorded backup demo and a tested hosted experience through judging, so that presentation does not depend on one live attempt.
78. As a builder, I want scope changes brought back for a decision when feasibility fails, so that the product is not silently replaced with a different experiment.

## Implementation Decisions

### Approved architecture and responsibility boundaries

- Build one NEAR testnet agent contract, a small off-chain service, and a responsive browser application. A Rust NEAR contract and TypeScript service and browser stack are the starting architecture from the supplied brief; verify current toolchain and SDK compatibility before pinning dependencies. There is no existing application architecture to preserve.
- The contract is authoritative for bankroll, retired funds, commitments, challenger custody, immutable prediction terms, deadlines, terminal outcomes, pending payment obligations, and death. Browser and service projections never override these rules.
- The service coordinates evidence collection, bounded model calls, validation, evidence publication, on-chain prediction submission, automatic settlement attempts, and recovery. It also supplies availability and indexed presentation of the small public record without becoming the financial authority. Do not introduce a database or indexer merely to duplicate contract truth.
- Keep external market-data, model, oracle, RPC, and wallet integrations behind narrow boundary adapters. Local fixtures replace those external providers in the reproducible demonstration, not the agent contract or accounting.
- The model receives only recent market history, the reference price, and the exact prediction and settlement rules. It cannot browse, call tools, move money, select arbitrary questions, set stakes, or change deadlines. Its response is a structured side and confidence, or abstention, plus a short justification.
- A public minute-candle source and NEAR AI Cloud are verified candidates for evidence and inference respectively. Actual authenticated inference and paid price refresh remain untested. Select a currently available structured-output-capable model through configuration, record its identity, and validate outputs without inventing or clipping its confidence.

### Prediction creation and fair odds

- Use the binary question in the Solution. Yes wins only when the valid settlement price is strictly greater than the reference price; equality resolves to no. Confidence is the probability assigned to the selected side, not necessarily the probability of yes.
- Allow at most one unresolved prediction and one accepted challenger. Creation and take operations must enforce this on-chain, not rely on a service mutex or disabled button. Concurrent visitor requests share the active forecast operation or receive a truthful busy state.
- A visitor starts forecasting opportunities on demand. Keep wallet preparation ahead of the visitor's intended playable forecast; retain the secondary wallet-free watch request. No background publication schedule is required. Upkeep continues during inactivity and abstention.
- Publication fixes the reference price, side, confidence, stakes, evidence fingerprint, and deadlines. The live horizon is five minutes and the take window is thirty seconds, both measured from actual publication. Off-chain inference and wallet preparation must not start those timers.
- Obtain a valid reference from the declared settlement-price provider and supply that reference to the model. Evidence-market prices may differ; preserve source identities, observation and fetch times, and the actual reference. Reject stale prerequisites rather than silently substituting an unrelated price. Bound evidence and reference age through measured pre-lock configuration.
- Code chooses the agent stake, no greater than 2% of spendable bankroll, and derives the opposing stake at fair odds without a house margin. At selected-side confidence q, the challenger-to-agent stake ratio is the probability of the agent being wrong divided by q. The contract validates this relation within explicitly documented smallest-unit rounding.
- Use integer monetary arithmetic with checked bounds. Define and test probability representation, allowed input bounds, rounding, minimum viable amounts, and exact deposit matching before deployment. Do not hide a pricing spread inside rounding. Size quotations with upkeep headroom so a normally timely challenge remains within the cap when accepted; revalidate after accrual without silently changing the published stake.
- No separate publication fee and no sink payment exist. Rate limits and operational budgets constrain inference and oracle spending, separately from bankroll upkeep. Never bypass them just because a request is anonymous.

### Settlement and payment safety

- Resolve using the first successful valid oracle request initiated after the deadline and completed within the configured bounded settlement window. Disclose that caller timing and provider caching influence this observation; it is not an exact historical expiry price.
- Prove the chosen oracle's paid refresh and callback path before committing to the live target. Check the expected provider and asset, response shape, price units, usable data, and documented freshness semantics. A callback's execution timestamp alone is not proof of an external market observation time.
- Serialize requests and identify their callbacks so retries cannot select between multiple valid competing outcomes, overwrite a terminal result, or pay twice. Late, duplicate, failed, and malformed callbacks have defined safe outcomes. A request that fails or never completes must not leave custody permanently stuck.
- Settle every published prediction where valid data exists, including unchallenged predictions. Accuracy counts valid resolved predictions independently of whether money was committed. Exclude voids from accuracy.
- On an agent win, release its committed stake and add the challenger's stake to usable bankroll, subject to permanent death. On a challenger win, return the challenger's stake plus the committed agent stake. On void, refund the challenger and release the agent commitment. Unchallenged outcomes move no betting funds.
- Record liabilities before asynchronous transfers. Confirm successful payments separately from the resolved prediction. Failed payments remain owed to the original beneficiary, with an idempotent retry or claim operation; no caller can redirect them. Preserve this recovery after death and when publication is unavailable. A pending payout remains in conservation accounting until confirmed or safely restored on failure.
- Once the settlement window is exhausted without a valid result, permit a safe void with refunds. Delayed callbacks cannot resurrect a voided prediction. Distinguish the failed price observation from a failed transfer after an already valid result.

### Bankroll, upkeep, and permanent death

- Initialize once. Partition actual funds and obligations into usable bankroll, commitments, challenger custody, retired bankroll, and an operational reserve. Measure storage needs and account for pending transfers and refunds; never treat the account's entire physical balance as spendable bankroll.
- Set upkeep relative to initial bankroll for fifteen days of idle life. Use accelerated, labelled settings only in local demonstrations. Upkeep is a configured economic rule, independent of actual AI invoices.
- Retire upkeep from spendable funds without transferring to a beneficiary. Retired funds cannot become usable bankroll or revive the agent. Unsolicited transfers do not increase the internal bankroll or life estimate.
- Accrue correctly across elapsed time, including fractional charges. Frequent calls cannot avoid upkeep through truncation. Views project effective life and availability rather than returning stale stored balances. Rejected actions cannot be relied on to persist an accrued death; a later valid mutation must also recognize depletion before crediting late funds.
- A death transition is irreversible. New predictions and takes are prohibited after depletion. Outstanding predictions, refunds, and payouts remain resolvable. Late wins or released commitments cannot enable new activity. Any post-death balances must remain permanently unusable for new stakes.
- Funding shortages, key allowance exhaustion, dependency failure, and missing inference are operational unavailability rather than a second definition of death. Show the appropriate cause and continue existing-obligation recovery wherever possible.

### Evidence and durable record

- Store compact immutable prediction terms, confidence, stakes, deadlines, evidence fingerprint, and final result on-chain. Keep payment recovery state without making terminal forecast terms editable. Expose bounded pagination and state reads suitable for the browser and keeper.
- Publish a canonical, downloadable evidence snapshot containing provider identities, observation and fetch times, the actual reference and rules given to the model, model and prompt configuration identity, structured response, and short justification. Commit the fingerprint before the prediction becomes challengeable. Retain snapshots through judging and preserve durable access afterward as part of the public record.
- The fingerprint detects edits but does not prove inference execution, source truth, or file availability. Off-chain model control, evidence hosting, the third-party oracle, and settlement timing remain disclosed dependencies. Do not claim private or attested inference.

### Interface, visual direction, and interaction contracts

- Apply the approved pre-code design direction: restrained futuristic tension, matte graphite surfaces, warm legible text, stable tabular numerical information, and a pale-phosphor primary action. Begin with a usable semantic 2D experience. Optional 3D must demonstrate a useful state-communication benefit and pass the performance budget before inclusion.
- Use one main scene updated by state, with at most one primary action. Some automatic states need none. Keep life, test-money status, the current prediction or latest result, and the beginning of the public record visible without a click. Use secondary disclosures for supporting evidence and technical detail.
- Financial consent requires visible stake, potential total return, deadline, network, and loss risk before approval. Do not hide those behind a disclosure. Distinguish signing, submitted transaction, confirmed take, pending oracle response, resolved result, pending payment, confirmed payment, and recoverable failure.
- Successful ready-wallet and disconnected-funded-wallet paths use at most two Reckon clicks: request and challenge. A path needing a funding link may use three. Wallet preparation starts directly from the first request action, then a still-active request resumes automatically after readiness. Count external wallet and faucet steps separately, and record retries and disclosures honestly in journeys that use them.
- A stale or canceled preparation flow must not unexpectedly launch inference. The watch path can request without a wallet. A request never reserves the one challenger slot; authoritative chain state determines the first valid take. Do not extend deadlines in the interface for late or slow visitors.
- After acceptance, progress to the result without a reveal click. A returning visitor can read it without wallet reconnection. Preserve context through reload, provider delays, failures, contention, and death.
- Design explicit loading, preparation, thinking, abstention, challenge-open, signature-pending, submitted, accepted, taken, closed, settling, resolved, void, payment-failure, operationally-unavailable, and dead states. Dead Reckon has no new-forecast action and retains its record.
- Support keyboard operation, visible focus, screen-reader labels and meaningful status announcements, adequate contrast, 200% text enlargement, reduced motion, and non-color outcome cues. Do not announce every countdown tick or move focus unexpectedly when the challenge window closes.
- Treat performance figures as targets to measure: 60 fps during active transitions on a defined mid-range mobile profile, local control feedback within 100 ms, and layout shift no greater than 0.1. The initial core compressed JS target is 200 KB, CSS 30 KB, and fonts 100 KB; lazy wallet and optional 3D bytes must be reported separately and in the total journey.
- Provide high, medium, and low quality behavior with identical essential information and actions. Conservative 2D is the default until profiling; low and reduced-motion behavior preserve a static life glyph and semantic state. Optional spatial rendering must not delay the core scene, run continuously while unchanged, or become a graphics-settings prerequisite.

### Release and irreversible lock

- Install and verify the required environment before estimating implementation throughput; the read-only environment check found no usable Linux Rust, NEAR CLI, Node, or package-manager toolchain. Do not assume the original brief's hour budget remains available.
- Rehearse on a replaceable testnet account. Only after the full lifecycle and permission checks pass, deploy the final directly held contract, initialize immutable configuration, add a function-call key restricted to prediction publication with a measured finite gas allowance, verify that key, and seek explicit approval to remove full-access keys.
- The final contract has no owner withdrawal, upgrade, administrative recovery, or key-management methods. Preserve proof of the deployed code and post-lock key permissions. Demonstrate that an old key cannot transfer or replace rules. A defect afterward requires a clearly identified replacement agent account.
- Size the gas allowance and reserve from measured publication, settlement, recovery, storage, and oracle costs. Account for the prediction key spending gas even on permitted calls that fail. Adding funds does not replenish an exhausted key allowance. External callers must still be able to settle and recover existing liabilities.
- Keep secrets out of source control and public evidence. Back up restricted service credentials securely. Host the browser, service, and evidence with availability through judging; the agent being alive and the infrastructure being online are different conditions.

## Testing Decisions

### Approved testing boundaries

Use the fewest useful boundaries. The primary acceptance boundary is the running browser application through the actual service into a real local NEAR sandbox running the compiled agent contract. Supply deterministic external evidence, model, oracle, and local-wallet fixtures at provider boundaries. Do not replace the agent contract, balances, timers, or asynchronous settlement behavior with a frontend simulation.

Supplement that with direct calls to the contract's public interface for adversarial authority checks, monetary bounds, fractional accrual, receipt failures, and concurrent or delayed callbacks that are impractical to exhaust through browser interaction. These tests observe externally visible state, receipts, key permissions, and actual account balances; they do not inspect private collections or mirror internal functions.

Use a small live testnet rehearsal for the actual wallet integration, authenticated model call, paid oracle refresh, and settlement callback. This verifies integrations that a deterministic local provider cannot establish. It is a release gate, not a replacement for reproducible local acceptance tests.

### Required observable coverage

- Drive request, readiness, inference, publication, challenge, result, payment, record, and life changes through the main application boundary. Include yes and no predictions and equality resolving to no.
- Demonstrate model abstention, invalid structured output, stale evidence or reference, unavailable inference, cooldown, concurrent requests, and no undisclosed fallback predictions. Evidence fingerprints must match the downloadable data and detect mutation.
- Verify quoted monetary terms against actual contract acceptance and transfers. Cover risk caps with elapsed upkeep, exact deposits, rounding bounds, unsupported tiny stakes, duplicate takes, late takes, and global unresolved-prediction exclusivity.
- Verify wins, losses, unchallenged outcomes, voids, failed observations, failed payments, retries, late callbacks, duplicate callbacks, and callback timeouts. No sequence may choose a second result, redirect liabilities, strand funds indefinitely, or pay twice.
- Compare conservation obligations against actual available account funds, accounting for measured storage, gas, deposits, pending transfers, and refunds. A narrated payment message or resolved status is insufficient evidence of payout.
- Advance real sandbox time to verify lazy upkeep, accurate projected views, fractional accrual, depletion, irreversible death, rejected post-death predictions and takes, and successful post-death settlement. Attempt revival by plain transfers, late wins, and commitment releases.
- Test publication by unauthorized identities, permitted and forbidden function-call-key actions, finite allowance exhaustion, initialization twice, attempts to mutate terminal terms, and inaccessible callback entry points. Verify final permissions and failed old-key authority in a rehearsal lock scenario.
- Count app clicks and external actions for ready, disconnected, and unfunded wallet paths, existing rounds, cancellations, retries, and contested slots. Confirm no result-reveal click, no unexpected request after cancellation, and no false acceptance before transaction confirmation.
- Verify all essential states with keyboard access, enlarged text, screen-reader status behavior, non-color cues, reduced motion, low-quality rendering, and WebGL failure. Test a mobile viewport and defined reference devices rather than relying solely on desktop screenshots.
- Measure frame-time distribution, control feedback, layout shift, initial and full-journey transfer sizes, and optional rendering cost. Do not infer 60 fps from low polygon count or a desktop average. The approved 2D experience must remain usable without optional assets.
- Run a clean local demonstration without personal credentials or paid inference, with deterministic simulated prices and scripted model responses clearly labelled. It must reach death within a bounded run and exit unsuccessfully if actual assertions on money, permissions, or post-death behavior fail.
- Perform the live rehearsal and compare the hosted behavior against the README before final locking, recording, and submission. Preserve a backup recording while there is still time to correct failures.

### Prior art

The repository currently contains only the initial readme, agent configuration, glossary, approved product and design documents, decision records, and research notes. There are no application tests or existing test seams. The source build brief's sandbox lifecycle checks are requirements to refine, not existing passing tests. No prototype has established a tested state model or integration API yet.

## Out of Scope

- Mainnet deployment or real-money wagering. A mainnet payout address for the hackathon does not change the application's testnet scope.
- Arbitrary prediction subjects, multiple price assets, chain-speed substitution, witnessed settlement, judge-specific predictions, disputes, or appeals.
- Multiple simultaneous agents, multiple unresolved predictions, multiple challengers per prediction, or reservations for forecast requesters.
- Background forecast publishing, house margin, adjustable model-selected stakes, a publication fee, or upkeep payments to a sink account.
- Account top-ups that increase usable bankroll, revival, owner withdrawals, upgrades, administrative recovery, or an in-place post-lock repair path.
- Model browsing, social or news feeds, autonomous model-invoked tools, generated biographies, chat, tokens, NFTs, profiles, or a separate registration system.
- A mandatory 3D engine, cinematic onboarding, decorative motion, autoplay audio, dashboard navigation before the core action, or additional disclosure clicks for consent-critical terms.
- Secure-hardware inference, proof of model execution, guaranteed historical exact-expiry pricing, or a claim that fair odds prove calibrated confidence.
- A database or indexer as a prerequisite, additional ecosystem integrations solely to satisfy perceived track requirements, or a silent terminal-only replacement for browser play.
- Hackathon publication or submission without the required human participation and confirmation. Creating this specification issue is not deployment, account locking, a public demo post, or the final event submission.

## Further Notes

This specification synthesizes the completed interview and approved pre-code design. The agreed glossary and seven architectural decisions remain authoritative. No numerical confidence range, reserve, settlement-window length, or dependency version should be mistaken for an already verified runtime fact. Treat the remaining measurements as explicit implementation gates, not invitations to silently change the product.

Complete feasibility early: verify the environment; demonstrate paid fresh-price delivery and callback handling; make a real structured inference request; measure evidence freshness, storage, gas, and request costs; and finalize documented operational parameters before immutable deployment. If those checks require changing the real-price target, trust model, browser experience, or permanent-death promise, return to the user for the scope decision. Do not spend the presentation reserve trying unrelated feature alternatives.

Plan around twelve working hours daily, with additional availability as buffer, and reserve the final six working hours for verification and submission. The target submission is 14 November 2026 at 22:00 IST. The official deadline is 15 November 2026 at 05:29 IST. Re-read the live event guide before submission rather than treating this dated summary as permanent event policy.

The repository must be public by the deadline and through judging, include a license and disclosures, and explain reproducible action-to-result steps. The human publishes the required X demo post with event identification, tags, and attached media. The submission's demo link is that post, while the hosted application and public code links belong in its content. A separately supplied mainnet payout address does not require a mainnet application. Submit once with the exact confirmed payload and use the change-request workflow for saved mistakes. Keep the hosted experience and evidence accessible through judging, ideally through 25 November.

Primary references already researched: [official event guide](https://nearhackathon.com/HACKATHON.md), [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys), [NEAR callback security](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks), [NEAR storage security](https://docs.near.org/smart-contracts/security/storage), [public oracle implementation](https://github.com/out-layer/oracle-example), [Coinbase public candles](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product-candles), [NEAR AI compatibility](https://docs.near.ai/cloud/guides/openai-compatibility), and [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility). Reconfirm changeable integrations during implementation.

The user approved this specification and its testing boundaries before publication to sivaratrisrinivas/reckon with the ready-for-agent label.
