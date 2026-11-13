use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

const GENERATION_KEY: &[u8] = b"diagnostic-generation-v1";

#[near(contract_state)]
#[derive(Default)]
pub struct Diagnostic {
    last_callback: Option<String>,
    pending: Option<String>,
    pending_started_ns: Option<u64>,
    generation: u64,
    oracle_override: Option<AccountId>,
}

#[near]
impl Diagnostic {
    #[init(ignore_state)]
    pub fn reset(oracle_id: Option<AccountId>) -> Self {
        assert_eq!(env::predecessor_account_id(), env::current_account_id());
        let generation = env::storage_read(GENERATION_KEY)
            .map(|bytes| {
                u64::from_le_bytes(bytes.try_into().expect("Invalid diagnostic generation"))
            })
            .unwrap_or(0);
        Self {
            oracle_override: oracle_id,
            generation,
            ..Self::default()
        }
    }

    pub fn oracle_id(&self) -> AccountId {
        self.oracle_override
            .clone()
            .unwrap_or_else(|| "price-oracle.testnet".parse().unwrap())
    }

    pub fn request(&mut self, nonce: String) -> Promise {
        assert_eq!(env::predecessor_account_id(), env::current_account_id());
        assert!(!nonce.is_empty() && nonce.len() <= 64 && !nonce.contains(':'));
        if let Some(started) = self.pending_started_ns {
            assert!(
                env::block_timestamp().saturating_sub(started) >= 120_000_000_000,
                "A diagnostic request is still pending"
            );
        }
        self.generation = self
            .generation
            .checked_add(1)
            .expect("Diagnostic generation overflow");
        env::storage_write(GENERATION_KEY, &self.generation.to_le_bytes());
        let request_id = format!("{}:{}", self.generation, nonce);
        self.last_callback = None;
        self.pending = Some(request_id.clone());
        self.pending_started_ns = Some(env::block_timestamp());
        let args = serde_json::json!({
            "receiver_id": env::current_account_id(),
            "asset_ids": ["wrap.near"],
            "msg": request_id,
            "resource_limits": null
        });
        Promise::new(self.oracle_id()).function_call(
            "oracle_call",
            serde_json::to_vec(&args).unwrap(),
            NearToken::from_millinear(20),
            Gas::from_tgas(200),
        )
    }

    pub fn oracle_on_call(&mut self, sender_id: AccountId, data: Value, msg: String) {
        assert_eq!(env::predecessor_account_id(), self.oracle_id());
        assert_eq!(sender_id, env::current_account_id());
        assert_eq!(self.pending.as_deref(), Some(msg.as_str()));
        let started = self.pending_started_ns.expect("Missing request start");
        assert!(
            env::block_timestamp().saturating_sub(started) < 120_000_000_000,
            "Diagnostic callback expired"
        );
        let (_, nonce) = msg
            .split_once(':')
            .expect("Malformed diagnostic request ID");
        self.pending = None;
        self.pending_started_ns = None;
        self.last_callback = Some(serde_json::json!({"nonce": nonce, "data": data, "callback_block_timestamp_ns": env::block_timestamp().to_string()}).to_string());
    }

    pub fn callback(&self) -> Option<String> {
        self.last_callback.clone()
    }
}
