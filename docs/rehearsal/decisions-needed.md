# Decisions needed before the live rehearsal and the lock

These items need your explicit scope decision. Each lists options and a recommendation; none of them has been decided or implemented. Nothing here was run live: every measurement referenced below came from the local sandbox with a fixture oracle, and every number marked PROPOSED is an assumption, not a verified fact.

## 1. Lost payment callbacks cannot be recovered on testnet

**Situation.** A native transfer and its `on_payment_complete` callback are separate receipts. The callback is the fast path that marks a liability paid. If the callback is lost or fails after the transfer succeeded, the attempt stays in flight. `retry_payment` correctly refuses an in-flight attempt, because a second transfer could pay the beneficiary twice, and a timeout alone never authorizes one (ADR 0008). The only way out of that state is `reconcile_payment` with a verified finalized receipt proof. The proof verifier exists for the local sandbox only: `new_live` passes no `receipt_genesis`, so `receipt_verifier` is `None` and `reconcile_payment` and `update_receipt_verifier` panic with "Receipt proofs are not configured for this network". On testnet, a lost callback would therefore leave a payment liability pending permanently. That does not meet story 38 ("failed payouts remain visible and recoverable") for this one failure mode. Failed transfers whose callback does arrive remain retryable.

**Options.**

- **A. Accept and disclose for the rehearsal and launch.** Keep the callback as the only testnet confirmation path, measure callback reliability during the live rehearsal, and state the limitation in the README and the in-app disclosures. No code change.
- **B. Add testnet receipt-proof support.** Extend the verifier to the testnet protocol version and validator sets, and a testnet genesis in a new initializer. This is the full answer, and it is large: it needs new light-client coverage, archive access to testnet history, and its own rehearsal.
- **C. Allow a timed re-send.** Rejected by ADR 0008: it can pay twice, and the contract cannot prove otherwise.
- **D. Change the payout model** (for example, record a payout as paid at send time and accept that a transfer to a deleted account is not recoverable). This changes story 38 and needs a scope decision of its own.

**Recommendation.** A for the rehearsal, with B as a post-rehearsal item only if the rehearsal observes a lost callback. Do not take C. Take D only as an explicit product change.

## 2. The service has no testnet mode, so the browser-to-testnet journey cannot be run yet

**Situation.** `service.ts` starts its own NEAR sandbox, funds an ephemeral browser signer and runs a fixture or live-provider forecast against that sandbox. There is no code path that points the service and browser at a testnet contract, uses a real wallet for the challenger, or runs the keeper against testnet. The first acceptance criterion (real market evidence, authenticated model inference, the actual wallet and the paid oracle refresh in one browser-to-testnet round) therefore cannot be satisfied by running existing code, and it is not satisfied.

**What is prepared.** `scripts/rehearsal/` drives the contract on a disposable testnet account directly: deploy and initialize with `new_live`, add the restricted key, publish, take, request settlement through the paid oracle, void, retry, probe the allowance, verify the deployed code and keys, and lock. That covers the oracle, callback, gas, storage and permission evidence. It does not cover the browser, the wallet or the model.

**Options.**

- **A. Build a testnet mode** for the service and a wallet connection in the browser, then run the full journey. Largest scope, and it belongs to the browser and service owners.
- **B. Rehearse the contract on testnet with the scripts and keep the browser journey on the sandbox**, using the live provider mode (already implemented for the sandbox) for real evidence and model calls. This leaves the real-wallet part of criterion 1 unmet and needs your approval as a scope change.
- **C. Both, in order:** B now, A only if time remains before the lock.

**Recommendation.** C. Run B first so the irreversible parameters rest on live oracle, gas and storage numbers, then decide whether A is worth its time.

## 3. Publication gas attached by the service

**Situation (local measurement).** A publication burned about 2.2 Tgas, but the service attaches 250 Tgas. The network reserves roughly ten times the attached gas at the gas price from the key's allowance before it accepts the call, then credits the unused part back. The reserved amount, not the burned amount, sets the allowance below which publication becomes impossible: about 0.25 NEAR at 250 Tgas against about 0.03 NEAR at 30 Tgas on the sandbox. The factor of ten and the gas price are sandbox values and must be reconfirmed on testnet (`probe-allowance` reads them).

**Options.** Keep 250 Tgas, or lower it. **Recommendation.** PROPOSED: lower to 30 Tgas after the testnet probe confirms the burn has at least a tenfold margin there. This is a one-line service change (`PUBLISH_GAS` in `service.ts`) that I did not make because it is a trust-model parameter.

## 4. Allowance and reserve values (PROPOSED)

The sizing in `docs/evidence/rehearsal-local-sizing.json` is derived from local measurements and assumptions that are all marked PROPOSED (30-day horizon, 12 publications a day, fourfold gas-price headroom, twofold burn headroom, 20% failed calls, 25% unmodelled margin). It uses recorded testnet oracle charges from the earlier feasibility probes, not new ones. It excludes model costs, which no run has measured. **Decision needed:** approve, change, or replace the horizon and headroom assumptions, and approve the final allowance and reserve only after the live rehearsal numbers replace the local ones. Neither value should be written into an immutable configuration before that.

## 5. Operational settings stay PROPOSED

Settlement window (120 s), reference age (candle 180 s, oracle 600 s), request cooldown (30 s), model-call budget (12 a day), minimum stakes (0.01 NEAR agent, 0.001 NEAR challenger), confidence range and rounding, and spending limits remain initial settings. The rehearsal can only measure oracle latency and cost in a handful of rounds; it cannot establish tail latency. **Decision needed:** how many live rounds you accept as evidence for the settlement window, and whether the window is finalized or stays an explicit initial setting at launch.

## 6. Where operational unavailability is shown

The contract cannot read its own access keys, so no contract view can report that the publication key's allowance is exhausted. The contract's `life` view correctly keeps saying the agent is alive with remaining life and spendable bankroll. The service reports the allowance, the reserve and the cause at `GET /api/operational` and refuses a forecast request before any inference when publication is unavailable, with a reason that says the agent is not dead. The browser shows that reason after a request. A proactive banner before the visitor asks needs a change in `public/`, which another agent owns. **Decision needed:** accept the service as the place where operational unavailability is reported (recommended, since the protocol offers no alternative), and schedule the proactive banner with the browser owner.

## 7. Initialization race and the atomic deploy

`new` and `new_live` are public until the account is initialized. `deploy-and-init.ts` deploys and initializes in one transaction, which closes the race. Any manual deployment must do the same. **Decision needed:** none, unless you prefer a different procedure; recorded so the final deployment follows it.
