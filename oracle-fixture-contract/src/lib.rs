use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const ASSET: &str = "wrap.near";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OracleFixture {
    owner_id: AccountId,
    scenario: String,
}

#[near]
impl OracleFixture {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            scenario: "below".to_string(),
        }
    }

    pub fn set_scenario(&mut self, scenario: String) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the fixture owner can change its response"
        );
        require!(
            matches!(
                scenario.as_str(),
                "below"
                    | "above"
                    | "equal"
                    | "invalid"
                    | "invalid_units"
                    | "stale"
                    | "wrong_asset"
                    | "wrong_request_id"
                    | "stalled"
            ),
            "Unsupported oracle fixture scenario"
        );
        self.scenario = scenario;
    }

    #[payable]
    pub fn oracle_call(
        &mut self,
        receiver_id: AccountId,
        asset_ids: Vec<String>,
        msg: String,
        _resource_limits: Option<Value>,
    ) -> Promise {
        require!(
            asset_ids.len() == 1 && asset_ids[0] == ASSET,
            "Unexpected oracle asset"
        );
        if self.scenario == "stalled" {
            return Promise::new(receiver_id).function_call(
                "oracle_callback_never_arrives".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                CALLBACK_GAS,
            );
        }

        let now = env::block_timestamp();
        let multiplier = match self.scenario.as_str() {
            "above" => "340823334",
            "equal" => "340823333",
            _ => "340823332",
        };
        let data = if self.scenario == "invalid" {
            serde_json::json!({"timestamp": now.to_string(), "recency_duration_sec": 300, "prices": []})
        } else {
            let timestamp = if self.scenario == "stale" {
                now.saturating_sub(301_000_000_000)
            } else {
                now
            };
            let asset_id = if self.scenario == "wrong_asset" {
                "other.asset"
            } else {
                ASSET
            };
            let decimals = if self.scenario == "invalid_units" {
                25
            } else {
                8
            };
            serde_json::json!({
                "timestamp": timestamp.to_string(),
                "recency_duration_sec": 300,
                "prices": [{"asset_id": asset_id, "price": {"multiplier": multiplier, "decimals": decimals}}]
            })
        };
        let callback_msg = if self.scenario == "wrong_request_id" {
            format!("{msg}:stale")
        } else {
            msg
        };
        let callback_args =
            serde_json::json!({"sender_id": receiver_id, "data": data, "msg": callback_msg});
        Promise::new(receiver_id.clone())
            .transfer(env::attached_deposit())
            .function_call(
                "oracle_on_call".to_string(),
                serde_json::to_vec(&callback_args).expect("Serialize oracle callback"),
                NearToken::from_yoctonear(0),
                CALLBACK_GAS,
            )
    }
}
