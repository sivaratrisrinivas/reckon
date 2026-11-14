# Payment receipt-proof feasibility (read-only research)

Research date: 2026-11-14. This note records protocol facts for issue #7 and
the first sandbox implementation. It is deliberately separate from the
implementation files.

## Verdict

NEAR can support a permissionless, trustless answer to this question:

> Did the finalized execution of this deployed Reckon payment attempt create
> the scheduled child receipt, and did that child receipt finish successfully
> or with failure?

The smallest workable proof is a genesis-anchored light-client update, a
proof of the Reckon source receipt, and a proof of the child selected by the
authenticated scheduler-event offset.
The source receipt must contain an authenticated, canonical attempt log. The
source proof authenticates the child receipt IDs; the child proof authenticates
the beneficiary executor and terminal status. A successful child outcome marks
the liability paid; a failed child outcome clears `transfer_in_flight` so the
same liability can be retried. A timeout alone remains unknown and must never
authorize another transfer.

There is an important boundary: the standard light-client execution proof
does **not** contain the raw `Receipt` or its `TransferAction.deposit`. It
proves an `ExecutionOutcomeView`, whose fields are receipt ID, child receipt
IDs, gas, burnt tokens, executor, status, and logs. Therefore the event plus
the known immutable source-code promise ordering is a semantic binding to the
amount and beneficiary, not a cryptographic proof of the raw transfer action.
If “exact transfer amount” means exact action-body verification, this design
needs an additional authenticated receipt-body/chunk proof or a protocol
redesign. An RPC `receipt` response is not a substitute: the caller supplies
it and the contract cannot authenticate it with the standard outcome proof.

## Primary protocol facts

- NEAR’s [light-client specification](https://nomicon.io/ChainSpec/LightClient.html)
  defines the state as the current `BlockHeaderInnerLiteView` plus current and
  next epoch validator sets. A `LightClientBlockView` can be accepted only at a
  higher height, in the current or next known epoch, with valid ordered
  approvals exceeding two-thirds of the previous epoch’s stake, and with
  `sha256(borsh(next_bps))` matching `next_bp_hash` when `next_bps` is present.
  The RPC is currently named `next_light_client_block`; the installed sandbox
  accepted `{last_block_hash: ...}`. Older Nomicon examples show positional
  parameters, so the relay must follow the target node’s schema.
- An outcome proof response contains only `outcome_proof`, its shard and block
  Merkle paths, a light block header, and a block Merkle path. The response
  schema has no receipt/action body. See the proof response in the
  [Nomicon specification](https://nomicon.io/ChainSpec/LightClient.html#transaction-outcome-proofs).
- Nearcore’s [execution outcome source](https://github.com/near/nearcore/blob/master/core/primitives/src/transaction.rs)
  defines `PartialExecutionOutcome` as `receipt_ids`, `gas_burnt`,
  `tokens_burnt`, `executor_id`, and a partial terminal status. Its
  `ExecutionOutcomeWithId::to_hashes` returns the outcome ID, the Borsh hash of
  that partial outcome, and one SHA-256 hash per log. This is why logs can be
  used as authenticated attempt metadata, while a transfer amount cannot be
  recovered from the outcome alone. The [chunk proof builder](https://github.com/near/nearcore/blob/master/chain/chain/src/types.rs)
  puts those vectors through `merklize` and stores the resulting chunk root.
- [Receipt views](https://github.com/near/nearcore/blob/master/core/primitives/src/views.rs)
  contain `predecessor_id`, `receiver_id`, `receipt_id`, and the raw receipt
  actions, but these fields are not part of the standard light-client outcome
  proof. A node-local receipt lookup therefore remains an untrusted RPC input.
- [NEAR receipts](https://nomicon.io/RuntimeSpec/Receipts) are the unit of
  cross-contract execution. A native transfer and its callback are separate
  receipts. `PromiseIndex` values returned while creating promises are local
  VM indices, not chain receipt hashes; the contract has no receipt-ID or
  transaction-hash host function. This missing host capability is tracked in
  [nearcore issue #13371](https://github.com/near/nearcore/issues/13371).

## Exact hash and signature algorithms

The contract must use protocol Borsh bytes, never JSON bytes or a hand-written
“equivalent” object encoding.

### Header and finality

For a light-client block view, with `L = borsh(inner_lite)` and the supplied
`inner_rest_hash` and `prev_block_hash`:

```text
inner_hash  = sha256(sha256(L) || inner_rest_hash)
block_hash  = sha256(inner_hash || prev_block_hash)
next_hash   = sha256(next_block_inner_hash || block_hash)
approval_message = borsh(ApprovalInner::Endorsement(next_hash)) ||
                   little_endian(inner_lite.height + 2)
```

In protocol-88/pre-Spice headers, `inner_lite` Borsh fields are height, epoch
ID, next epoch ID, previous state root, previous outcome root (JSON calls this
`outcome_root`), timestamp nanoseconds, next-BP hash, and block-Merkle root.
The installed verifier’s rejection of a non-null `chunk_execution_root` is
intentional version gating; it must not silently hash a post-Spice header as a
pre-Spice one.

Approvals are positional: the ith optional signature is checked against the
ith validator of the block’s epoch. Count only signatures that verify. Reject
unless `approved_stake > floor(total_stake * 2 / 3)`. Trailing approvals from
the next epoch may be ignored, as allowed by the specification. A supplied
`next_bps` is Borsh-serialized as the versioned `ValidatorStakeView` list (V1
enum tag, account ID, public-key enum/tag and bytes, stake), then hashed with
SHA-256. Do not hash the JSON representation or omit the version/public-key
tags. The first verifier intentionally accepts only Ed25519 keys; nearcore’s
`PublicKey` also has other variants, so rejecting those is safe but limits
which future validator sets it can follow.

### Outcome and Merkle roots

For protocol 88, nearcore’s canonical outcome leaf is equivalent to the
`ApplyChunkResult::compute_outcomes_proof` construction in nearcore:

```text
outcome_hashes(outcome) = [outcome_id, sha256(borsh(partial)),
                           sha256(log_0.as_bytes()), ...]
outcome_leaf = sha256(borsh(outcome_hashes(outcome)))
```

The runtime puts one such `outcome_hashes` vector per executed outcome into a
Merkle tree. The chunk root is then one leaf in the block's chunk-root tree;
that is why the RPC verifier hashes the shard root before applying
`outcome_root_proof` (and why the empty-path, one-shard sandbox still has an
outer SHA-256). This is not a direct `sha256(borsh(ExecutionOutcomeView))`
of the JSON object.

```text
partial = borsh(
  Vec<CryptoHash> receipt_ids,
  u64 gas_burnt,
  u128 tokens_burnt,
  AccountId executor_id,
  PartialExecutionStatus,
)
leaf_items = [outcome_id, sha256(partial),
              sha256(log_0.as_bytes()), ...]
outcome_leaf = sha256(borsh(leaf_items))
shard_outcome_root = merkle_root(outcome_leaf, outcome_proof.proof)
block_outcome_root = merkle_root(sha256(borsh(shard_outcome_root)),
                                 outcome_root_proof)
```

`PartialExecutionStatus` uses the protocol discriminants: Unknown=0,
Failure=1, SuccessValue=2 followed by a Borsh byte vector, and
SuccessReceiptId=3 followed by a 32-byte hash. A reconciler should reject
Unknown, and must not attempt to Borsh-serialize the opaque Failure debug
payload. `merkle_root` combines left/right children as
`sha256(left || right)`, with the exact path directions returned by RPC. The
result must equal `block_header_lite.inner_lite.outcome_root`.

For the block path, recompute the light header’s block hash and require
`merkle_root(block_hash, block_proof) == verified_head.block_merkle_root`.
The standard response also carries `outcome_proof.block_hash`, which names the
same outcome-root block. It is a useful response-consistency check, but it is
redundant for soundness once the outcome and both Merkle paths are checked:
the paths already bind the outcome to `block_header_lite.inner_lite` and the
header to the verified head. If checked, compare it with the recomputed
header hash. Do **not** compare it with `block_header_lite.prev_block_hash`.
In the captured sandbox proof, `outcome_proof.block_hash = AS79…` and the
recomputed header hash is `AS79…`, while `prev_block_hash = GDx…` is the
execution block's predecessor. The receipt outcome's own RPC metadata says
`block_hash = GDx…`: nearcore executes the receipt in GDx and commits that
outcome root in the following block AS79.

## Genesis and epoch bootstrap

The genesis anchor is trusted configuration, not caller-provided recent state.
It must commit to one exact network: genesis block hash, genesis validator
list, and the genesis header’s `next_bp_hash`. The contract must reject a
second/different anchor. A caller relaying a recent header cannot replace this
anchor.

NEAR’s genesis epoch is special. Genesis has the all-zero epoch ID; the first
blocks can continue using that ID, and the first transition points at the
genesis block hash. In the generated near-sandbox 2.14.0 probe, genesis and
the first epoch used the zero epoch ID, and the first accepted light-client
view was height 2 with `next_epoch_id = genesis_hash`. Initializing
`current_epoch = zero`, `next_epoch = genesis_hash`, and both validator slots
from the genesis set is therefore consistent with the sandbox bootstrap, but
must be tested against the exact target network’s genesis.

The first update may skip intermediate blocks because the validator approval
is for the reconstructed next block and the protocol permits a higher-height
final light-client view. On an epoch transition, use the previously committed
`next_bps` as the signing set, require the new view to carry `next_bps`, verify
its `next_bp_hash`, then rotate current/next sets. Do not accept an unknown
epoch or an uncommitted validator set.

The local probe used the generated sandbox genesis (one validator, epoch length
500, near-sandbox 2.14.0 / protocol 88). This demonstrates bootstrap mechanics
only; a one-validator sandbox does not model mainnet’s stake-distribution
security. Mainnet/testnet deployment requires their own hard-coded or otherwise
independently audited genesis constants and future protocol-version support.

## Payment-attempt binding

The current contract’s canonical source event is useful because logs are part
of the authenticated outcome leaf. A safe proof relay should:

1. Observe the **source receipt outcome**, not only the transaction outcome.
   The source receipt executes Reckon and emits the attempt event. A
   transaction outcome can merely report a generated receipt ID and normally
   does not carry the contract execution log.
2. Verify the source outcome under the finalized head and require
   `executor_id == current_account_id`, a terminal successful status, exactly
   one canonical event matching deployment instance, prediction/payment ID,
   attempt ID, beneficiary, and amount, and a known child-receipt shape. Events
   for other payments batched into the same source receipt are validated and
   counted so offsets stay correct, but are never selected.
3. Select the child receipt ID from the source outcome’s `receipt_ids` and
   verify that child outcome. Require its ID equals the selected ID, its
   `executor_id` equals the recorded beneficiary, and its status is terminal
   success (empty `SuccessValue` for a native transfer) or `Failure`.
4. Mark the existing attempt paid only on child success. On child failure,
   clear `transfer_in_flight` while retaining the same payment identity so a
   retry cannot redirect the liability. Never infer either result from a
   timeout, a balance query, or a caller’s raw receipt JSON.

Do not use “the first child” as a global rule. A public transaction can batch
several `FunctionCall` actions into one source `ActionReceipt`, so the source
outcome can contain several oracle/payment effects. The deployed scheduler
must emit one canonical effect log for **every** promise-producing method:
the oracle event denotes one child; a payment-attempt event denotes exactly
two children (native transfer, then callback). Scan logs in order, count the
children implied by preceding canonical events, and use that offset into
`outcome.receipt_ids`; reject unknown/ambiguous effect logs and duplicate
matching payment events.

This offset rule is supported by current nearcore source, not by an RPC
ordering accident. `apply_action_receipt` executes actions in vector order;
`ActionReceiptResult::merge` appends each action's logs and newly-created
receipts in that same order. For one function call,
`action_function_call` converts `ReceiptManager.action_receipts` in creation
order and appends data receipts afterward. Receipt IDs are assigned only after
all action results and refunds have been merged. Deposit/gas-refund receipts
are appended after the action-generated receipts, so they cannot shift the
effect offsets at the front. See nearcore’s
[receipt execution loop](https://github.com/near/nearcore/blob/master/runtime/runtime/src/lib.rs),
[result merge](https://github.com/near/nearcore/blob/master/runtime/runtime/src/lib.rs),
and [function-call receipt conversion](https://github.com/near/nearcore/blob/master/runtime/runtime/src/function_call.rs).

The ordering is still a deployed-code/runtime invariant, not a receipt-body
proof. Pin the event format and deployment/code instance; otherwise a future
promise reordering or a redeployment could make an offset identify a
different receipt. The contract cannot discover the receipt ID itself; the
relay obtains it from the source outcome and passes the authenticated proof
back.

The source event authenticates the amount and beneficiary selected by the
deployed contract, but it does not prove that the raw child action carried the
same amount. This semantic distinction must remain explicit in the API and
security model. For strict action-level binding, add an authenticated proof of
the outgoing receipt body (including `TransferAction.deposit`) through chunk
receipt roots, or redesign the payment so the contract can verify a protocol
object whose amount is itself in the authenticated outcome/log.

## Review findings for the first verifier

Status for the local sandbox verifier (`contract/src/receipt_proofs.rs`,
`reconcile_payment`): the outcome `block_hash` check, current-head proofs
(`height <= verified head`), the pre-Spice header gate, ordered effect
accounting with batched payments (covered by `tests/payment-reconciliation.ts`)
are implemented. The 64-validator bound and network-specific genesis remain
scoped to the sandbox, so this verifier is not yet production-safe for testnet
or mainnet. The checks below were required before treating it as
production-safe:

- Optionally require `outcome_proof.block_hash` to equal the recomputed
  `block_header_lite` hash as an RPC-shape consistency check. This field is
  not an independent security anchor: the outcome leaf and both Merkle paths
  already bind the execution to that header. Never mistake the field for
  `block_header_lite.prev_block_hash` (the captured proof has AS79 versus
  GDx, respectively).
- Decide whether proofs in the current head are supported. The protocol allows
  statements about the head itself; a strict `< head.height` guard only
  supports ancestors and should be documented or changed to `<=`.
- Keep the pre-Spice header gate. If a future header has a non-null
  `chunk_execution_root`, reject until the new Borsh/header/proof rules are
  implemented; do not silently hash the old field list.
- Require the source event/effect sequence to account for every
  promise-producing method before indexing `receipt_ids`; do not assume the
  first child when multiple function-call actions can be batched. For a
  payment event, require two distinct child IDs and bind the transfer proof
  to the event's first offset child; test two payments in one source receipt,
  including rejection of a proof for the other payment's child. Treat the
  transfer/callback relation as a versioned code/runtime invariant.
- The first verifier’s `validators.len() <= 64` bound is a local gas/DoS bound,
  not a NEAR protocol limit. It is fine for the one-validator sandbox but must
  be raised or explicitly scoped before following a testnet/mainnet set.
- Keep the genesis constants network-specific. The sandbox’s
  `EXPERIMENTAL_genesis_config` is convenient for tests but is an RPC response;
  production initialization must not let an arbitrary caller choose a recent
  checkpoint or validator set.

## Simpler primitives considered

There is no synchronous same-chain contract primitive for querying an arbitrary
finalized receipt outcome. `promise_result` is available only to the callback
receipt, and a callback timeout says nothing about whether the transfer receipt
already succeeded. Node RPC methods such as transaction status, raw receipt
lookup, or the optional receipt-to-transaction index are operational relay
inputs, not trustless contract facts. The callback fast path plus permissionless
light-client reconciliation is therefore the simplest trustless option that
preserves the existing asynchronous native-transfer protocol.

## References

- [NEAR light client specification](https://nomicon.io/ChainSpec/LightClient.html)
- [NEAR epoch IDs and bootstrap](https://nomicon.io/ChainSpec/EpochAndStaking/Epoch.html)
- [NEAR consensus approvals](https://nomicon.io/ChainSpec/Consensus.html)
- [NEAR receipts](https://nomicon.io/RuntimeSpec/Receipts)
- [nearcore execution outcomes](https://github.com/near/nearcore/blob/master/core/primitives/src/transaction.rs)
- [nearcore receipt and outcome views](https://github.com/near/nearcore/blob/master/core/primitives/src/views.rs)
- [nearcore receipt/action definitions](https://github.com/near/nearcore/blob/master/core/primitives/src/receipt.rs)
- [near-sdk Promise API](https://docs.rs/near-sdk/5.30.1/near_sdk/struct.Promise.html)
- [nearcore issue: expose triggering receipt/transaction identity](https://github.com/near/nearcore/issues/13371)

