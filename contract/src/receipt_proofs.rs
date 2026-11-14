//! NEAR protocol-88 light-client headers and execution proofs. The immutable
//! constructor input is the local network's genesis, never a recent checkpoint.
use near_sdk::{
    base64::Engine,
    env,
    json_types::{U128, U64},
    near, require,
    serde_json::Value,
    AccountId,
};

type Hash = [u8; 32];

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Validator {
    account_id: AccountId,
    public_key: String,
    stake: U128,
}

#[near(serializers = [json])]
pub struct Genesis {
    genesis_hash: String,
    next_bp_hash: String,
    validators: Vec<Validator>,
}

#[near(serializers = [borsh])]
struct VerifiedHead {
    hash: Hash,
    height: u64,
    block_merkle_root: Hash,
}

#[near(serializers = [borsh])]
pub struct ReceiptVerifier {
    genesis_hash: Hash,
    hash: Hash,
    height: u64,
    epoch: Hash,
    next_epoch: Hash,
    validators: Vec<Validator>,
    next_validators: Vec<Validator>,
    block_merkle_root: Hash,
    known_heads: Vec<VerifiedHead>,
}

#[near(serializers = [json])]
pub struct Head {
    pub hash: String,
    pub genesis_hash: String,
    pub height: U64,
}

impl ReceiptVerifier {
    pub fn new(genesis: Genesis) -> Self {
        let hash = hash_string(&genesis.genesis_hash);
        require!(hash != [0; 32], "Genesis hash is missing");
        require!(
            validator_hash(&genesis.validators) == hash_string(&genesis.next_bp_hash),
            "Genesis validators do not match their commitment"
        );
        Self {
            genesis_hash: hash,
            hash,
            height: 0,
            epoch: [0; 32],
            next_epoch: hash,
            validators: genesis.validators.clone(),
            next_validators: genesis.validators,
            block_merkle_root: [0; 32],
            known_heads: vec![VerifiedHead {
                hash,
                height: 0,
                block_merkle_root: [0; 32],
            }],
        }
    }

    pub fn head(&self) -> Head {
        Head {
            genesis_hash: near_sdk::bs58::encode(self.genesis_hash).into_string(),
            hash: near_sdk::bs58::encode(self.hash).into_string(),
            height: U64(self.height),
        }
    }

    pub fn update(&mut self, block: &Value) {
        bounded(block);
        let inner = &block["inner_lite"];
        require!(
            inner["chunk_execution_root"].is_null(),
            "Unsupported NEAR header protocol"
        );
        let height = number(&inner["height"]);
        require!(
            height > self.height,
            "Header is not newer than the verified head"
        );
        let epoch = hash_value(&inner["epoch_id"]);
        let advancing_epoch = epoch != self.epoch;
        require!(
            !advancing_epoch || epoch == self.next_epoch,
            "Unknown validator epoch"
        );
        let validators = if advancing_epoch {
            &self.next_validators
        } else {
            &self.validators
        };
        let next_epoch = hash_value(&inner["next_epoch_id"]);
        require!(
            advancing_epoch || next_epoch == self.next_epoch,
            "Next epoch changed within an epoch"
        );
        let next_validators = if block["next_bps"].is_null() {
            require!(
                !advancing_epoch,
                "Epoch transition requires the next validator set"
            );
            self.next_validators.clone()
        } else {
            near_sdk::serde_json::from_value::<Vec<Validator>>(block["next_bps"].clone())
                .expect("Invalid validator set")
        };
        require!(
            validator_hash(&next_validators) == hash_value(&inner["next_bp_hash"]),
            "Invalid next validator commitment"
        );
        let hash = header_hash(block);
        let next_hash = combine(hash_value(&block["next_block_inner_hash"]), hash);
        let mut message = vec![0]; // ApprovalInner::Endorsement
        message.extend(next_hash);
        message.extend(
            height
                .checked_add(2)
                .expect("Header height overflow")
                .to_le_bytes(),
        );
        let approvals = array(&block["approvals_after_next"]);
        require!(approvals.len() <= 128, "Too many approvals");
        let mut total = 0u128;
        let mut approved = 0u128;
        for (index, validator) in validators.iter().enumerate() {
            total = total
                .checked_add(validator.stake.0)
                .expect("Validator stake overflow");
            if let Some(signature) = approvals
                .get(index)
                .filter(|signature| !signature.is_null())
            {
                let signature = key_bytes::<64>(string(signature));
                let public_key = key_bytes::<32>(&validator.public_key);
                require!(
                    env::ed25519_verify(&signature, &message, &public_key),
                    "Invalid finality signature"
                );
                approved = approved
                    .checked_add(validator.stake.0)
                    .expect("Approved stake overflow");
            }
        }
        // Division avoids overflow and preserves the strict > 2/3 threshold.
        let threshold = (total / 3) * 2 + ((total % 3) * 2) / 3;
        require!(
            approved > threshold,
            "Header does not have finalized stake quorum"
        );
        if advancing_epoch {
            self.validators = self.next_validators.clone();
        }
        self.next_validators = next_validators;
        self.epoch = epoch;
        self.next_epoch = next_epoch;
        self.height = height;
        self.hash = hash;
        self.block_merkle_root = hash_value(&inner["block_merkle_root"]);
        self.known_heads.push(VerifiedHead {
            hash: self.hash,
            height: self.height,
            block_merkle_root: self.block_merkle_root,
        });
        // Bound storage while allowing independently prepared proofs to survive
        // concurrent header updates. Evicted proofs can be rebuilt at a new head.
        if self.known_heads.len() > 64 {
            self.known_heads.remove(0);
        }
    }

    pub fn verify<'a>(&self, proof: &'a Value) -> &'a Value {
        bounded(proof);
        let selected_hash = proof
            .get("light_client_head")
            .map(hash_value)
            .unwrap_or(self.hash);
        let selected = self
            .known_heads
            .iter()
            .find(|head| head.hash == selected_hash)
            .expect("Proof head is not a retained verified header");
        let header = &proof["block_header_lite"];
        let height = number(&header["inner_lite"]["height"]);
        require!(height <= selected.height, "Receipt block is not finalized");
        let hash = header_hash(header);
        if height == selected.height {
            require!(
                hash == selected.hash && array(&proof["block_proof"]).is_empty(),
                "Receipt header is not the verified head"
            );
        } else {
            require!(
                path(hash, &proof["block_proof"]) == selected.block_merkle_root,
                "Receipt block is not in the verified chain"
            );
        }
        let execution = &proof["outcome_proof"];
        require!(
            hash_value(&execution["block_hash"]) == hash,
            "Outcome declares a different commitment block"
        );
        let shard_root = path(outcome_hash(execution), &execution["proof"]);
        let root = path(sha(&shard_root), &proof["outcome_root_proof"]);
        require!(
            root == hash_value(&header["inner_lite"]["outcome_root"]),
            "Invalid receipt outcome proof"
        );
        execution
    }
}

fn validator_hash(validators: &[Validator]) -> Hash {
    require!(
        !validators.is_empty() && validators.len() <= 64,
        "Unsupported validator set size"
    );
    let mut bytes = Vec::new();
    bytes.extend((validators.len() as u32).to_le_bytes());
    for (index, validator) in validators.iter().enumerate() {
        require!(validator.stake.0 > 0, "Validator has no stake");
        require!(
            !validators[..index]
                .iter()
                .any(|other| other.account_id == validator.account_id),
            "Duplicate validator"
        );
        bytes.push(0); // ValidatorStake::V1
        bytes.extend(near_sdk::borsh::to_vec(&validator.account_id).unwrap());
        bytes.push(0); // PublicKey::ED25519
        bytes.extend(key_bytes::<32>(&validator.public_key));
        bytes.extend(validator.stake.0.to_le_bytes());
    }
    sha(&bytes)
}

fn header_hash(header: &Value) -> Hash {
    let inner = &header["inner_lite"];
    require!(
        inner["chunk_execution_root"].is_null(),
        "Unsupported NEAR header protocol"
    );
    let mut bytes = Vec::new();
    bytes.extend(number(&inner["height"]).to_le_bytes());
    for field in [
        "epoch_id",
        "next_epoch_id",
        "prev_state_root",
        "outcome_root",
    ] {
        bytes.extend(hash_value(&inner[field]));
    }
    bytes.extend(decimal_u64(&inner["timestamp_nanosec"]).to_le_bytes());
    bytes.extend(hash_value(&inner["next_bp_hash"]));
    bytes.extend(hash_value(&inner["block_merkle_root"]));
    combine(
        combine(sha(&bytes), hash_value(&header["inner_rest_hash"])),
        hash_value(&header["prev_block_hash"]),
    )
}

fn outcome_hash(execution: &Value) -> Hash {
    let outcome = &execution["outcome"];
    let receipts = array(&outcome["receipt_ids"]);
    require!(receipts.len() <= 128, "Too many child receipts");
    let mut partial = Vec::new();
    partial.extend((receipts.len() as u32).to_le_bytes());
    for receipt in receipts {
        partial.extend(hash_value(receipt));
    }
    partial.extend(number(&outcome["gas_burnt"]).to_le_bytes());
    partial.extend(
        string(&outcome["tokens_burnt"])
            .parse::<u128>()
            .expect("Invalid tokens burnt")
            .to_le_bytes(),
    );
    let executor: AccountId = string(&outcome["executor_id"])
        .parse()
        .expect("Invalid receipt executor");
    partial.extend(near_sdk::borsh::to_vec(&executor).unwrap());
    let status = outcome["status"]
        .as_object()
        .expect("Invalid execution status");
    require!(status.len() == 1, "Ambiguous execution status");
    if let Some(value) = status.get("SuccessValue") {
        partial.push(2);
        let value = near_sdk::base64::engine::general_purpose::STANDARD
            .decode(string(value))
            .expect("Invalid return value");
        require!(value.len() <= 4096, "Return value is too large");
        partial.extend(near_sdk::borsh::to_vec(&value).unwrap());
    } else if let Some(receipt) = status.get("SuccessReceiptId") {
        partial.push(3);
        partial.extend(hash_value(receipt));
    } else {
        require!(status.contains_key("Failure"), "Receipt is not terminal");
        partial.push(1); // PartialExecutionStatus intentionally omits failure details.
    }
    let logs = array(&outcome["logs"]);
    require!(logs.len() <= 64, "Too many receipt logs");
    let mut hashes = vec![hash_value(&execution["id"]), sha(&partial)];
    for log in logs {
        require!(string(log).len() <= 4096, "Receipt log is too large");
        hashes.push(sha(string(log).as_bytes()));
    }
    sha(&near_sdk::borsh::to_vec(&hashes).unwrap())
}

fn path(mut hash: Hash, path: &Value) -> Hash {
    let steps = array(path);
    require!(steps.len() <= 64, "Merkle path is too long");
    for step in steps {
        let sibling = hash_value(&step["hash"]);
        hash = match string(&step["direction"]) {
            "Left" => combine(sibling, hash),
            "Right" => combine(hash, sibling),
            _ => env::panic_str("Invalid Merkle direction"),
        };
    }
    hash
}

fn bounded(value: &Value) {
    require!(
        near_sdk::serde_json::to_vec(value).unwrap().len() <= 65_536,
        "Proof exceeds supported size"
    );
}
fn combine(left: Hash, right: Hash) -> Hash {
    sha(&[left.as_slice(), right.as_slice()].concat())
}
fn sha(bytes: &[u8]) -> Hash {
    env::sha256_array(bytes)
}
fn array(value: &Value) -> &[Value] {
    value.as_array().expect("Expected array")
}
fn string(value: &Value) -> &str {
    value.as_str().expect("Expected string")
}
fn number(value: &Value) -> u64 {
    value.as_u64().expect("Expected unsigned integer")
}
fn decimal_u64(value: &Value) -> u64 {
    string(value).parse().expect("Invalid decimal integer")
}
fn hash_value(value: &Value) -> Hash {
    hash_string(string(value))
}
fn hash_string(value: &str) -> Hash {
    near_sdk::bs58::decode(value)
        .into_vec()
        .expect("Invalid base58 hash")
        .try_into()
        .expect("Invalid hash length")
}
fn key_bytes<const N: usize>(value: &str) -> [u8; N] {
    let value = value
        .strip_prefix("ed25519:")
        .expect("Only ed25519 is supported");
    near_sdk::bs58::decode(value)
        .into_vec()
        .expect("Invalid ed25519 encoding")
        .try_into()
        .expect("Invalid ed25519 length")
}
