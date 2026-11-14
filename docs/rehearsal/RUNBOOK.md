# Live rehearsal runbook (human-run)

Nothing in this runbook has been run. Every command below is for you to run against a disposable testnet account. The automated checks and the agent that prepared this runbook used only the local NEAR sandbox with a fixture oracle: no testnet transaction, no paid oracle call, no model call, no deployment and no spending took place.

Read `docs/rehearsal/decisions-needed.md` first. Two of its items change what this rehearsal can prove: the service has no testnet mode, so the browser, wallet and model journey cannot be rehearsed on testnet with the current code; and a lost payment callback cannot be recovered on testnet.

## What the prepared evidence already covers (local sandbox, not live)

| Question | Local evidence | Live status |
| --- | --- | --- |
| Gas, storage and balance cost of publication, take, settlement, void, retry, receipt reconciliation | `docs/evidence/rehearsal-local-measurements.json` | Needs human live run |
| Reserve and key allowance sizing from those numbers | `docs/evidence/rehearsal-local-sizing.json` (all PROPOSED) | Needs human live run |
| Restricted key permissions, rehearsal lock, allowance exhaustion, funding, recovery by other callers, death versus exhaustion | `tests/rehearsal-permissions.ts` | Needs human live run |
| Static audit of exports, source and key list | `tests/rehearsal-static-audit.ts` | Needs human live run on the deployed code |
| Service and browser show operational unavailability apart from death | `tests/key-allowance.spec.ts`, `tests/operational-assessment.ts` | Needs human live run |
| Paid oracle refresh, callback latency and cost; model cost; real wallet; real evidence; real challenger payout | none | Needs human live run |

The only live oracle numbers in the repository are the earlier probes in `docs/evidence/testnet-latency-cost-samples.json` and `docs/research/price-settlement-feasibility.md`.

## 0. Rules for every step

- Use only accounts named `reckon-rehearsal-<suffix>.testnet`. The scripts refuse any other name, any network but testnet, and any run without `--confirm-disposable-testnet`.
- Each script prints public information only: account names, public keys, transaction hashes, code hashes, amounts and gas. Private keys are read from files you create with mode 600 and are never printed. Redaction runs on everything written to `.local/rehearsal/`.
- Never commit anything under `.local/`, any key file, or `.env`. Never paste a key into chat.
- The accounts and funds are disposable. Do not deploy this build to an account that holds anything you need.
- Start the rehearsal when you can finish it the same day: `new_live` fixes fifteen days of idle upkeep, so the bankroll starts retiring at once.

## 1. Environment and local gates

From the repository root, with the pinned toolchains (see the README):

```sh
./scripts/with-local-env.sh npm run build:contract
./scripts/with-local-env.sh npx tsx tests/rehearsal-static-audit.ts
sha256sum contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm
```

Record the SHA-256 digest. The deployed code is compared with it later. The build must be the production artifact, not `reckon_contract_callback_fault.wasm`; the deploy script refuses a Wasm whose exports fail the audit.

## 2. Create the disposable accounts and key files

You need three accounts, all matching the name pattern:

- the agent account, for example `reckon-rehearsal-a1.testnet`
- a challenger, for example `reckon-rehearsal-a1-taker.testnet`
- a keeper, for example `reckon-rehearsal-a1-keeper.testnet` (it pays gas for settlement, void and retry calls, as the service's keeper does)

Create and fund them with the NEAR CLI or a testnet wallet. The scripts only need each account's full-access secret key in a file readable by you alone:

```sh
chmod 600 <owner-key-file> <taker-key-file> <keeper-key-file>
```

The file may hold the bare `ed25519:...` secret key or a JSON object with `secret_key`. Fund the agent account with at least bankroll plus reserve plus the code storage stake (about 4.4 NEAR for this 443 KB Wasm at 0.00001 NEAR per byte; see the measurements file). Fund the challenger above the quoted challenger stake, and the keeper with a few NEAR.

## 3. Deploy and initialize in one transaction

Choose the bankroll, reserve and allowance. The local sizing is in `docs/evidence/rehearsal-local-sizing.json`; it is PROPOSED and was derived without any testnet measurement, so treat it as a starting point for the rehearsal, not as the final configuration. Use a small bankroll for the rehearsal.

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/deploy-and-init.ts \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --owner-key-file <owner-key-file> \
  --bankroll-near <n> --reserve-near <n> --allowance-near <n>
```

This deploys the Wasm and calls `new_live` in the same transaction, so nobody can initialize the account first, then adds the restricted publication key (`publish_prediction` only, receiver the agent itself, finite allowance). It writes the generated prediction key to `.local/rehearsal/<account>/prediction-key.json` (mode 600, never printed) and prints the code hash and the prediction public key. Confirm `code_hash_matches` is true.

## 4. Verify the code and keys before any round

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/lock-and-verify.ts verify \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-public-key <prediction public key> --expect unlocked
```

This fetches the code the chain holds, checks its hash against your local build, audits its exported methods, and audits the key list. Before the lock it must report the owner's full-access key and the restricted key and nothing else.

## 5. Measure the allowance the network requires

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts probe-allowance \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet --owner-key-file <owner-key-file>
```

It adds a throwaway key with a one-yoctoNEAR-scale allowance, sends rejected publications at 30, 50, 100 and 250 Tgas, reads the required allowance from each `NotEnoughAllowance` error, and deletes the probe key. Compare with `required_allowance_per_publication_yocto_by_prepaid_gas` in the local measurements. On the sandbox the requirement was about ten times the attached gas at the gas price plus about 0.0009 NEAR, with unused gas credited back. If testnet differs, `ALLOWANCE_RESERVATION_FACTOR` in `operational.ts` and the sizing must change before a lock.

## 6. Run rounds and record measurements

Take a snapshot before and after each phase:

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts snapshot \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet
```

**Publish.** Terms are operator-supplied here because the service cannot publish to testnet; this is not a model forecast. Get a current reference price yourself (`price-oracle.testnet`), and use the verified public storage-test snapshot from `docs/evidence/blob-storage-verification.json` or another real https evidence URL and its SHA-256:

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts publish \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-key-file .local/rehearsal/reckon-rehearsal-a1.testnet/prediction-key.json \
  --decision no --confidence-ppm 850000 --reference-multiplier <n> --reference-decimals <n> \
  --evidence-hash <64 hex> --evidence-url <https url> --gas-tgas 250
```

Run it once with `--gas-tgas 250` (what the service attaches today) and once with `--gas-tgas 30`. The record shows gas burnt, allowance consumed, and the agent's net balance fall.

**Take.** Within 30 seconds of publication (read the prediction's `challenge_deadline_ns`), and only if you want a challenged round:

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts take \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-id <id> --challenger-account reckon-rehearsal-a1-taker.testnet --challenger-key-file <taker-key-file>
```

**Settle with the paid oracle.** At or after the deadline (five minutes after publication) and before the cutoff (120 seconds later):

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts request-settlement \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-id <id> --caller-account reckon-rehearsal-a1-keeper.testnet --caller-key-file <keeper-key-file>
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts wait-resolved \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet --prediction-id <id>
```

The contract attaches 0.02 NEAR from the agent account to the oracle; the oracle refunds the unused part. `wait-resolved` records the chain-time round trip between the request and the accepted callback. Repeat for an unchallenged round, a challenger win and an agent win. Collect enough rounds that you are comfortable with the settlement window; the existing evidence has five samples and a 50.356 second maximum, which establishes no tail.

**Void.** Publish and take, let the deadline and the whole 120 second window pass without requesting settlement, then:

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/round.ts void \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-id <id> --caller-account reckon-rehearsal-a1-keeper.testnet --caller-key-file <keeper-key-file>
```

This measures void and the refund payment without needing the oracle to fail.

**Retry.** `retry_payment` is only reachable after a failed transfer whose callback ran. To rehearse it, delete the challenger account (with the NEAR CLI) before settlement, let settlement fail the transfer, recreate the account, then run `round.ts retry-payment` with the same options as `void`. Skip this if you do not want to delete the challenger; the local retry measurement exists, and the lost-callback case cannot be rehearsed on testnet at all (decision 1).

## 7. Rehearse allowance exhaustion

Use a second disposable agent account (repeat sections 2 to 4) deployed with a small allowance sized from the probe: the required allowance at your chosen gas, plus about two and a half publications' burn, as `tests/rehearsal-permissions.ts` does locally. Publish and settle until the network rejects publication with `NotEnoughAllowance`, keeping one challenged prediction outstanding when it does. Then:

- confirm `round.ts snapshot` shows the life view not dead, with spendable bankroll intact;
- send funds to the account and confirm the allowance does not change;
- settle the outstanding prediction with the keeper account and recover any failed payout.

## 8. Rehearse the lock

On the first agent account, after the rounds:

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/lock-and-verify.ts lock \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-public-key <prediction public key> --owner-key-file <owner-key-file> \
  --confirm-delete-full-access-key reckon-rehearsal-a1.testnet
./scripts/with-local-env.sh npx tsx scripts/rehearsal/lock-and-verify.ts prove-old-key-useless \
  --confirm-disposable-testnet --network testnet --account reckon-rehearsal-a1.testnet \
  --prediction-public-key <prediction public key> --owner-key-file <owner-key-file>
```

`lock` runs the pre-lock verification first, deletes the owner's only full-access key (irreversible for that account), and then runs the locked verification. `prove-old-key-useless` sends a transfer, an add-key, a deploy and a delete-account with the deleted key; each must be rejected as `AccessKeyNotFound`. After the lock, publish once more with the restricted key and settle a round with the keeper to show the locked account still works.

## 9. Model and evidence costs (sandbox-bound live provider mode)

The service's live provider mode uses real market data, the configured model and public evidence storage, but it publishes to a local sandbox contract. Run it only with your own `.env` (never printed or committed):

```sh
./scripts/with-local-env.sh npm start        # with RECKON_PROVIDER_MODE=live in the private .env
```

After a few requests, read the model usage recorded in each evidence snapshot under `.local/evidence/` (`forecast.usage`, `forecast.latency_ms`) and compare token counts with your provider dashboard for cost. Model cost is not part of any on-chain figure and no run has measured it.

## 10. Record evidence without secrets

`.local/rehearsal/<account>/log.json` holds every step's public record (transaction hashes, gas, balances, code hash, key list, verification results). Review it before sharing:

```sh
grep -i -E "secret|private" .local/rehearsal/reckon-rehearsal-a1.testnet/log.json   # expect no output
```

Then copy it to `docs/evidence/rehearsal-live-<date>-<account>.json` and commit that file only. Do not commit key files. Add the explorer links for the transaction hashes, the code hash, and the final key list to the same file.

## 11. Compare with the local numbers

```sh
./scripts/with-local-env.sh npx tsx scripts/rehearsal/compare-evidence.ts --log .local/rehearsal/reckon-rehearsal-a1.testnet/log.json
```

Any ratio above the assumed headroom (gas burn twofold, gas price fourfold) means the PROPOSED allowance and reserve in `docs/evidence/rehearsal-local-sizing.json` must be re-derived from the live number. Re-run `scripts/rehearsal/assemble-local-evidence.ts` only for local files; record live-derived sizing in a new file, not over the local one.

## 12. Disposal

Delete the disposable accounts with their remaining funds returned to a faucet or your own account, and remove `.local/rehearsal/<account>/`. A locked account cannot be deleted by its restricted key; leave it, since it holds only testnet money.
