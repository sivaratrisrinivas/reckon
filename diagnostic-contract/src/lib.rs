use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

#[near(contract_state)]
#[derive(Default)]
pub struct Diagnostic {
    last_callback: Option<String>,
}

#[near]
impl Diagnostic {
    pub fn request(&mut self) -> Promise {
        assert_eq!(env::predecessor_account_id(), env::current_account_id());
        self.last_callback = None;
        let args = serde_json::json!({
            "receiver_id": env::current_account_id(),
            "asset_ids": ["wrap.near"],
            "msg": "reckon-diagnostic",
            "resource_limits": null
        });
        Promise::new("price-oracle.testnet".parse::<AccountId>().unwrap()).function_call(
            "oracle_call",
            serde_json::to_vec(&args).unwrap(),
            NearToken::from_millinear(20),
            Gas::from_tgas(200),
        )
    }

    pub fn oracle_on_call(&mut self, sender_id: AccountId, data: Value, msg: String) {
        assert_eq!(
            env::predecessor_account_id().as_str(),
            "price-oracle.testnet"
        );
        assert_eq!(sender_id, env::current_account_id());
        assert_eq!(msg, "reckon-diagnostic");
        self.last_callback = Some(serde_json::json!({"data": data, "callback_block_timestamp_ns": env::block_timestamp().to_string()}).to_string());
    }

    pub fn callback(&self) -> Option<String> {
        self.last_callback.clone()
    }
}
