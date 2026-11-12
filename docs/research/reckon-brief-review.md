# Reckon: brief and hackathon review

Reviewed 13 November 2026, IST. This is an assessment, not an approved implementation spec.

## Sources and scope

Read both supplied files in full:

- `/mnt/c/Users/Srinivas/Downloads/oracle-build-brief.md`, 491 lines.
- `/mnt/c/Users/Srinivas/Downloads/oracle-submission-pack.md`, 142 lines.

Checked the live [event website](https://nearhackathon.com/), [official participant guide](https://nearhackathon.com/HACKATHON.md), and the official example prompts for [Agent Economy](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/07-agents.md), [Games](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md), [Open Innovation](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/13-open.md), and [Security](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md).

The user's chosen project name is **Reckon**. “Oracle I” can remain the character's name, subject to confirmation. The supplied documents' commands and build sequence are proposals to assess, not authorization to execute them. No deployments, account creation, key deletion, publication, or submission were performed during this review.

The review verifies event requirements and selected architectural facts. It does not verify every SDK version, provider endpoint, price-feed address, or runtime dependency in the brief. The hour-one gates have not been run.

## Product understanding

Reckon makes prediction confidence economically consequential. A single agent publishes checkable predictions with confidence and stakes. A challenger funds the opposing position. Settlement either adds the challenger's stake to the agent's bankroll or pays the challenger both stakes. A recurring ledger charge consumes spendable bankroll. Death permanently prevents new predictions; existing obligations must remain settleable. The permanent record supports calibration statistics and a life story.

The defining demonstration is a real challenge that settles and pays, followed by visible loss of remaining life. The deletion of full-access keys supplies a second proof: the builder cannot directly withdraw or replace the contract through those keys afterward.

## Verified event requirements

The official guide confirms:

- Deadline: **15 November 2026, 05:29 IST**, equivalent to 14 November 23:59 UTC. The brief's earlier target, 14 November 22:00 IST, leaves 7 hours 29 minutes of slack.
- Judging starts 16 November 05:30 IST; results are due by 19 November 05:29 IST.
- Testnet-only projects qualify for every track. No particular ecosystem integration is mandatory; an appropriate NEAR contract is sufficient.
- Public repository by the deadline, remaining public through judging; a LICENSE file is required.
- Code since 19 October counts. Libraries, templates, and AI-generated code are allowed with disclosure. Writing every line anew is a proposed project constraint, not an event requirement.
- A reproducible local-only demo is eligible. It needs a video when judges cannot open the demo; screenshots alone are insufficient in that case. Hosting is a plus, rather than an eligibility requirement.
- The public X demo post must identify NEAR HACKATHON and include @NEARProtocol and #NEARHackathon, with video or screenshots as appropriate.
- The submission's demo URL is the X post URL. A hosted application URL can be linked from the post and README.
- A mainnet payout account is required even for a testnet build. No mainnet deployment is required.
- One submission per project. Changes use the request-changes workflow. An API submission uses a stable requestId across eligible retries and needs the human's exact-payload confirmation.
- AI screening checks reproducibility and claimed behavior and produces a preliminary report; humans decide. Low AI score alone cannot reject a project.

These facts come from the [participant guide](https://nearhackathon.com/HACKATHON.md). The website mentions technical implementation, design, impact, originality, and sustainability as guidance from previous events, not a published numerical scoring rubric for this event.

## Track fit

Recommended primary positioning: **Open Innovation** and **Agent Economy**. Games is credible if challenging the Oracle is a compelling repeatable game loop. Security is worth considering if the delivered demo proves restricted authority and enforced spending constraints. These are recommendations, not selected submission tracks. The prompts' sample projects are examples, not additional rules.

## Issues to resolve before implementation

### 1. Prediction time and settlement time differ

The proposed price callback reads the feed when settlement executes, not necessarily at the advertised expiry. A 15-minute window lets the first caller choose an advantageous moment. Cross-contract execution adds further delay. The brief acknowledges this limitation, but the headline prediction still describes an exact time.

The chain-speed fallback has the same mismatch: its formula measures through settlement, while its text says “until expiry.” Choose a verifiable reference observation, or explicitly define the prediction around the actual observation rule. Automatic settlement alone does not establish fair measurement.

### 2. The model does not currently make the forecast

The proposed algorithm randomly chooses a confidence and direction, calculates a strike using a volatility model, and optionally asks an LLM for wording. That is an automated quantitative forecaster with an AI persona. It does not test an LLM's predictive confidence. Decide which claim Reckon should make; do not let presentation imply a capability absent from the implementation.

### 3. The odds constraint does not establish honesty

The inequality requires nonnegative expected profit under the agent's own stated probability. The worked example is consistent with that inequality. It cannot establish that the stated probability is accurate, honestly estimated, or calibrated. Calibration and Brier score provide observational evidence later; a small demo sample cannot prove reliability.

### 4. Death needs a precise state transition

Accrue followed by a failing assertion in the same receipt can roll back the newly recorded death. A separate successful poke can commit it, but rejected actions alone cannot be relied on to do so. The [NEAR storage security guide](https://docs.near.org/smart-contracts/security/storage) explicitly documents receipt-level rollback on panic.

Also define death after fees or stakes reduce free funds to zero, death timing between keeper calls, and post-death accrual. Preserve fractional accrued costs so frequent calls cannot repeatedly round the charge down to zero. Define handling of late winnings: dead stays dead even if funds return. “Never spendable again” also needs to agree with pay_sink and subsequent accrual behavior.

### 5. Payout promises need failure recovery

Marking an outcome and scheduling a transfer is not proof that the recipient was paid. Specify pending liabilities, successful payment confirmation, retry or claim behavior after failure, and protection from duplicate payouts. The sink payment needs the same treatment. Include pending obligations in conservation checks. [NEAR's callback guide](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks) illustrates restoring accounting when an asynchronous operation fails.

### 6. Logical bankroll is different from physical account balance

Ignored transfers cannot revive the internal bankroll, but they still increase the real account balance and can support gas or storage. The unrestricted gas allowance also means the brain key has an economic power beyond the prophesy business rules: it can spend gas through permitted calls, including failed calls. The reserve must cover gas, growing history, and obligations without consuming reserved challenger funds. [Access-key documentation](https://docs.near.org/protocol/accounts-contracts/access-keys) confirms unlimited gas when allowance is omitted; [storage guidance](https://docs.near.org/smart-contracts/security/storage) explains the balance required for state growth.

Consequently, “nobody can rescue it” must refer precisely to irreversible ledger death, rather than an inability to send funds or sustain infrastructure. A function-call key cannot directly transfer NEAR, but contract code can still execute allowed payments.

### 7. Several limits need explicit enforcement rules

Specify whether the per-prophecy cap applies to oracle_stake multiplied by all slots, and check aggregate exposure when takes occur. Specify decimal and arithmetic bounds, checked multiplication for price comparisons, equality outcomes, zero block-height differences, positive daily cost, text limits, pagination, and response validation. The tests listed in the brief do not cover every one of these cases.

### 8. A settlement callback can fail after the first receipt succeeds

Open to Settling prevents duplicate initiation, but needs a recovery policy if the callback panics or runs out of gas. A prophecy must not remain permanently stuck while holding stakes. Validate feed freshness and asset identity in the callback, not only non-nullness, and decide how delayed callbacks interact with timeout voiding.

### 9. The life meter and life story can become stale

Views cannot persist accrued costs, so state views must project the current effective balance and life rather than merely return the last stored values. The story cache invalidates only on settled-count changes in the brief, which misses death or bankroll changes without settlement. An instruction to an LLM to use only supplied numbers is not output validation; use validated structured content or deterministic text for financial claims.

### 10. “Thinking costs” are an economic rule

The daily charge and publication fee reimburse a fixed sink; they are not metered AI invoices. This remains true in template-only mode. Describe them as a configured upkeep rule unless actual compute accounting is added. The sink is an explicit permitted beneficiary, so “nobody can withdraw” needs to distinguish arbitrary withdrawals from specified transfers.

### 11. The death demo is not yet guaranteed

A fixed random seed does not on its own prove death before the three-minute limit. Wins can extend life, and timing can vary. Use a deterministic scenario whose invariants guarantee the intended ending, and independently test real winning, losing, void, and failed-payment paths. Do not present scripted demo outcomes as live forecasting skill.

### 12. Schedule and survival assumptions need recalculation

The 36-hour plan assumes a starting budget that may no longer be available. Installation, first-time Rust contract work, a reliable sandbox runner, wallet integration, deployment, and video production all compete for that budget. Six NEAR at 0.4 per day lasts 15 idle days; publication fees and losses shorten that. The proposed 12-day minimum would not necessarily sustain an agent started 13 November through 25 November. Hosting uptime and the Oracle remaining alive are different requirements.

## Recommended scope and flow

Preserve one Oracle, testnet funds, one objectively settleable prediction kind, one complete challenge/payout loop, irreversible death, key-permission evidence, and an honest reproducible demo. Defer witnessed judge predictions, generated life stories, and extra kinds until this loop works. These are scope recommendations, not changes already accepted by the user.

Use **grill-with-docs** next to settle product decisions and record agreed vocabulary and consequential decisions. Use a small **prototype** only for a question conversation cannot resolve, especially settlement timing or death accounting. Then **to-spec**, followed by **to-tickets** for demoable vertical slices. These skills' installed instructions were read before recommending this route. The concept is already concrete enough that a larger **wayfinder** process appears unnecessary.

The first decisions are what role the AI should play, what exactly a prediction's observation rule means, and which features are essential to the submission. Infrastructure facts such as feed availability should be investigated by the agent, not delegated to the user as guesswork. No spec, issues, or implementation have been published by this review.
