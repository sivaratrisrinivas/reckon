# Reckon: agreed product decisions

These decisions were accepted during the grill-with-docs interview on 13 November 2026, IST. The user confirmed the shared product and design understanding, completing the interview. This is the approved basis for a specification, not an implementation spec or authorization to deploy, lock accounts, or submit.

## Essential experience

One agent publishes a prediction, one person challenges it, settlement pays the correct party, and the agent gains or loses remaining life. Preserve permanent death and the public prediction record. Defer judge-specific predictions, witnessed settlement, generated biographies, and multiple prediction types.

## Forecast and stakes

The AI receives a defined evidence snapshot and chooses a forecast and confidence, or abstains. Record the evidence and model response for inspection. If inference is unavailable, publish no new prediction. See ADR 0002.

Limit model inputs to recent NEAR market-price history, the reference price, and the exact prediction and settlement rules. The model returns its chosen side and confidence, or abstention, plus a short justification. No news search, social feeds, browsing, or model-invoked tools are required. The specific public market-data source and model remain subject to feasibility checks.

Constrain forecasts to one predefined question format and prediction horizon. Code produces the exact wording and financial terms. The evidence source remains undecided.

The agreed question is: "Will the settlement price of NEAR/USD be strictly above the reference price?" The model chooses yes, no, or abstention, with confidence in its selected side. An unchanged price resolves to no.

Live predictions run for five minutes, and challenges close thirty seconds after publication. Fix the reference price, confidence, stakes, and deadlines at publication. Local demos may use shorter timings with clear labels.

Only one prediction may remain unresolved at a time. When idle, a visitor can click "Ask Reckon" to request a forecast. The AI decides whether to predict or abstain. Once published, challenge timing, settlement, and payout proceed automatically. No background publication schedule is required; upkeep continues between visits. Apply request cooldowns and an operational spending limit against spam. See ADR 0006.

Each prediction accepts one challenger. Code chooses a small capped stake and derives the challenger's stake from confidence using a disclosed pricing rule. The model cannot negotiate stakes, increase its budget, invent payout terms, or directly move money. Monetary rounding remains to be defined.

Risk at most 2% of spendable bankroll per prediction. Stakes shrink with spendable funds, and predictions with stakes too small to support are skipped. A loss of 2% of initial bankroll corresponds to about seven hours of initial idle life at the chosen upkeep rate. Minimum supported amounts and rounding remain to be defined.

Use fair odds derived directly from the model's confidence, without a house margin. For example, 75% confidence pairs a 0.12 NEAR agent stake with a 0.04 NEAR challenger stake. At the quoted probability the betting expectation is zero before upkeep; rounding and limits still need definition.

The live target is real NEAR-price forecasts, conditional on a short feasibility check for fresh data and settlement. Simulated prices belong in reproducible tests and the local demo. If the live path fails, revisit scope with the user rather than silently changing the prediction subject.

Resolve every published prediction when valid settlement data is available, including those without a challenger. Unchallenged predictions affect accuracy but move no betting funds. Mark predictions with unavailable valid settlement data as void and exclude them from accuracy calculations.

## Public evidence

Store the prediction, confidence, stakes, deadlines, result, and an evidence fingerprint on-chain. Publish the corresponding evidence snapshot, model identity, structured forecast, and short justification as downloadable data with durable hosting. The on-chain fingerprint detects edits to that evidence; it cannot recover a missing file or prove that the model received those inputs. See ADR 0005.

## Player experience

The user's strict UI and UX constraints and required pre-code design process are recorded in `docs/design-requirements.md`. The user confirmed these requirements and the detailed direction in `DESIGN.md` as part of the shared understanding.

The accepted visual direction is restrained futuristic tension, progressing from curiosity through challenge and anticipation to consequence. The core player objective is challenging the prediction with understood stakes and seeing the outcome. Limit Reckon-controlled interactions to three clicks and report external wallet interactions separately. Prepare the wallet before generating the visitor's intended playable forecast, while retaining wallet-free spectating and requests. `DESIGN.md` records the approved pre-code direction; its performance budgets and proposed flows still require implementation verification.

The hosted website must let strangers view the record and request forecasts without signing up. Taking the opposing side requires connecting a testnet wallet and approving the stake. Keep the fast reproducible local demo separate and clearly label its simulated price feed. A terminal-only live experience requires an explicit scope decision rather than a silent substitution.

## Final account lock

The irreversible lock is a required part of the final demonstration. Rehearse and verify the system first, then remove all full-access keys from the final agent account, leaving only the restricted prediction key. The contract must provide no method restoring administrative control. A defect after locking requires a new agent account clearly identified as a replacement. Actual key deletion still requires the user's explicit approval when reached.

Give the prediction key a finite lifetime gas allowance, sized from measured costs with headroom and backed by an operational reserve. Exhaustion prevents further publication through that key; adding funds does not replenish its allowance. Existing predictions must remain settleable by other callers. Distinguish operational unavailability from irreversible bankroll death. See ADR 0007.

## Settlement observation

Use the price returned by the first successful oracle request initiated after the prediction deadline and completed within a short settlement window. If no valid result arrives in time, void the prediction and refund the challenger. Show this rule before staking and disclose that caller timing and provider caching can affect outcomes. Do not claim the result is a historical price at the exact deadline. The settlement window length and valid-response criteria remain undecided. See ADR 0003.

## Death and upkeep

Death permanently prevents new predictions and challenges. Existing challenges still settle and pay; late winnings and unsolicited funds cannot revive the agent. See ADR 0001.

Upkeep is a configured recurring charge, independent of actual AI invoices. The life meter estimates how long spendable funds will last at that upkeep rate.

Upkeep permanently retires funds from the usable bankroll without paying a sink or reimbursement account. Retired funds remain in the contract account and cannot fund new stakes or revival; they are not described as burned tokens. Actual hosting, AI, gas, and oracle expenses remain operational costs. See ADR 0004.

Set the initial upkeep rate to provide fifteen days of idle life relative to the starting bankroll, before betting gains or losses. Local demos use accelerated upkeep to demonstrate death within minutes. The live life meter is an estimate that future betting results can change.

Remove the separate per-prediction publication fee. Actual gas and oracle-request costs still need an operational budget.

## Remaining engineering checks

The read-only investigation found a working unauthenticated Coinbase NEAR-USD minute-candle endpoint and the NEAR AI Cloud model catalog. These are feasible candidates, not tested inference or settlement integrations. See `docs/research/market-data-and-model-feasibility.md`.

Before committing to a live immutable deployment, prove paid price refresh and callback settlement, verify source freshness and identity, test actual model inference, and measure contract storage growth and transaction costs. Derive the settlement window, gas allowance, cooldown, operational limits, reserve, minimum amounts, and monetary rounding from the agreed behavior and these measurements. Reject invalid model outputs rather than inventing forecasts or silently changing its confidence.

Operational shortages must not be misreported as bankroll death. New predictions should stop when their operational prerequisites cannot be met, while existing obligations remain recoverable. Simulation and scripted local-test forecasts must be labelled and kept separate from live model forecasts.

Any failure requiring a change to the agreed product, trust model, browser experience, or live price target comes back to the user as a scope decision.

## Working budget

The builder is available 12 to 15 hours per day. Plan around 12 hours daily and reserve the final six working hours for verification and submission; additional availability is buffer.

The brief's target submission time remains 14 November 2026, 22:00 IST. Recalculate the remaining budget as work proceeds instead of treating the original 36-hour estimate as remaining time.
