use near_sdk::serde_json::{self, Value};
use near_sdk::{
    env,
    json_types::{U128, U64},
    near, require,
    store::LookupMap,
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use uint::construct_uint;

construct_uint! { struct U256(4); }

const LIVE_IDLE_LIFE_NS: u64 = 15 * 24 * 60 * 60 * 1_000_000_000;
const QUESTION: &str = "Will the NEAR/USD settlement price be strictly above the reference price?";
const CONFIDENCE_SCALE: u32 = 1_000_000;
// These are initial quote bounds. Rehearsal measurements must confirm them before live locking.
const MIN_CONFIDENCE_PPM: u32 = 100_000;
const MAX_CONFIDENCE_PPM: u32 = 900_000;
const MAX_AGENT_RISK_BPS: u128 = 200;
const BASIS_POINTS: u128 = 10_000;
const YOCTO_PER_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MIN_AGENT_STAKE: u128 = YOCTO_PER_NEAR / 100;
const MIN_CHALLENGER_STAKE: u128 = YOCTO_PER_NEAR / 1_000;
const CHALLENGE_WINDOW_NS: u64 = 30 * 1_000_000_000;
const PREDICTION_HORIZON_NS: u64 = 5 * 60 * 1_000_000_000;
// The longest recorded paid refresh callback took 50.356 seconds. The 120-second
// window is a bounded initial setting with room for that observation; it is not a tail guarantee.
const SETTLEMENT_WINDOW_NS: u64 = 120 * 1_000_000_000;
const MAX_ORACLE_RECENCY_SECONDS: u64 = 300;
const MAX_ORACLE_RESPONSE_AGE_NS: u64 = 300 * 1_000_000_000;
const ORACLE_REQUEST_DEPOSIT: u128 = 20_000_000_000_000_000_000_000;
const ORACLE_REQUEST_GAS: Gas = Gas::from_tgas(200);
const PAYMENT_CALLBACK_GAS: Gas = Gas::from_tgas(10);
const ORACLE_ASSET_ID: &str = "wrap.near";
const MAX_PREDICTION_PAGE_SIZE: u64 = 50;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Reckon {
    initial_bankroll: u128,
    spendable: u128,
    committed_bankroll: u128,
    challenger_custody: u128,
    retired: u128,
    operational_reserve: u128,
    idle_life_ns: u64,
    last_accrual_ns: u64,
    fractional: u128,
    dead: bool,
    prediction_public_key: String,
    oracle_account_id: AccountId,
    next_prediction_id: u64,
    active_prediction_id: Option<u64>,
    next_oracle_request_id: u64,
    valid_outcomes: u64,
    correct_outcomes: u64,
    predictions: LookupMap<u64, Prediction>,
}

#[near(serializers = [json])]
pub struct Life {
    initial_bankroll: U128,
    spendable_bankroll: U128,
    committed_bankroll: U128,
    challenger_custody: U128,
    retired_bankroll: U128,
    operational_reserve: U128,
    remaining_life_ns: U64,
    idle_life_ns: U64,
    dead: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Prediction {
    id: U64,
    question: String,
    reference_multiplier: U128,
    reference_decimals: u8,
    decision: String,
    confidence_ppm: u32,
    agent_stake: U128,
    challenger_stake: U128,
    evidence_hash: String,
    evidence_url: String,
    published_at_ns: U64,
    challenge_deadline_ns: U64,
    deadline_ns: U64,
    challenger_account_id: Option<String>,
    challenged_at_ns: Option<U64>,
    agent_stake_committed: bool,
    settlement_status: String,
    settlement_request_id: Option<String>,
    settlement_requested_at_ns: Option<U64>,
    settlement_price: Option<SettlementPrice>,
    outcome: Option<String>,
    settled_at_ns: Option<U64>,
    payment: Option<PaymentLiability>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SettlementPrice {
    multiplier: U128,
    decimals: u8,
    response_timestamp_ns: U64,
    provider_recency_seconds: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PaymentLiability {
    beneficiary_account_id: String,
    amount: U128,
    status: String,
    transfer_in_flight: bool,
}

#[near(serializers = [json])]
pub struct PredictionSummary {
    published: U64,
    valid_outcomes: U64,
    correct_outcomes: U64,
}

#[near(serializers = [json])]
pub struct PredictionQuote {
    confidence_ppm: u32,
    agent_stake: U128,
    challenger_stake: U128,
    minimum_agent_stake: U128,
    minimum_challenger_stake: U128,
    confidence_scale: u32,
}

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Predictions,
}

#[near]
impl Reckon {
    #[init]
    pub fn new_live(
        initial_bankroll: U128,
        operational_reserve: U128,
        prediction_public_key: String,
    ) -> Self {
        Self::new(
            initial_bankroll,
            operational_reserve,
            U64(LIVE_IDLE_LIFE_NS),
            prediction_public_key,
            "price-oracle.testnet".parse().unwrap(),
        )
    }

    #[init]
    pub fn new(
        initial_bankroll: U128,
        operational_reserve: U128,
        idle_life_ns: U64,
        prediction_public_key: String,
        oracle_account_id: AccountId,
    ) -> Self {
        require!(
            initial_bankroll.0 > 0 && idle_life_ns.0 > 0,
            "Bankroll and idle life must be positive"
        );
        require!(
            prediction_public_key.starts_with("ed25519:") && prediction_public_key.len() > 20,
            "Prediction key must be an ed25519 public key"
        );
        let required = initial_bankroll
            .0
            .checked_add(operational_reserve.0)
            .expect("Funding overflow");
        require!(
            env::account_balance().as_yoctonear() >= required,
            "Insufficient contract funding"
        );
        Self {
            initial_bankroll: initial_bankroll.0,
            spendable: initial_bankroll.0,
            committed_bankroll: 0,
            challenger_custody: 0,
            retired: 0,
            operational_reserve: operational_reserve.0,
            idle_life_ns: idle_life_ns.0,
            last_accrual_ns: env::block_timestamp(),
            fractional: 0,
            dead: false,
            prediction_public_key,
            oracle_account_id,
            next_prediction_id: 1,
            active_prediction_id: None,
            next_oracle_request_id: 1,
            valid_outcomes: 0,
            correct_outcomes: 0,
            predictions: LookupMap::new(StorageKey::Predictions),
        }
    }

    pub fn life(&self) -> Life {
        let (spendable, retired, fractional, dead) = self.project(env::block_timestamp());
        let numerator =
            U256::from(spendable) * U256::from(self.idle_life_ns) - U256::from(fractional);
        let remaining = if dead {
            0
        } else {
            ((numerator + U256::from(self.initial_bankroll - 1))
                / U256::from(self.initial_bankroll))
            .as_u64()
        };
        Life {
            initial_bankroll: U128(self.initial_bankroll),
            spendable_bankroll: U128(spendable),
            committed_bankroll: U128(self.committed_bankroll),
            challenger_custody: U128(self.challenger_custody),
            retired_bankroll: U128(retired),
            operational_reserve: U128(self.operational_reserve),
            remaining_life_ns: U64(remaining),
            idle_life_ns: U64(self.idle_life_ns),
            dead,
        }
    }

    pub fn accrue(&mut self) {
        self.accrue_at(env::block_timestamp());
    }

    pub fn quote_prediction(&self, confidence_ppm: u32) -> PredictionQuote {
        self.checked_quote(confidence_ppm, env::block_timestamp())
    }

    pub fn publish_prediction(
        &mut self,
        reference_multiplier: U128,
        reference_decimals: u8,
        decision: String,
        confidence_ppm: u32,
        evidence_hash: String,
        evidence_url: String,
    ) -> Prediction {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Prediction key must call the agent account directly"
        );
        require!(
            env::signer_account_pk().to_string() == self.prediction_public_key,
            "Prediction key is not authorized"
        );
        require!(
            self.active_prediction_id.is_none(),
            "An unresolved prediction already exists"
        );
        require!(!self.dead, "Reckon is permanently dead");
        require!(
            reference_multiplier.0 > 0 && reference_decimals <= 24,
            "Invalid reference price"
        );
        require!(
            decision == "yes" || decision == "no",
            "Decision must be yes or no"
        );
        require!(
            evidence_hash.len() == 64
                && evidence_hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            "Evidence fingerprint must be a lowercase SHA-256 digest"
        );

        let now = env::block_timestamp();
        require!(
            evidence_url.starts_with("https://")
                && evidence_url.len() <= 2048
                && evidence_url.len() > 8
                && evidence_url.is_ascii()
                && !evidence_url
                    .bytes()
                    .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
                && !evidence_url.contains(['@', '?', '#']),
            "Evidence URL must be a bounded public HTTPS URL"
        );
        self.accrue_at(now);
        require!(!self.dead, "Reckon is permanently dead");
        let quote = self.checked_quote(confidence_ppm, now);
        let id = self.next_prediction_id;
        self.next_prediction_id = id.checked_add(1).expect("Prediction id overflow");
        let prediction = Prediction {
            id: U64(id),
            question: QUESTION.to_string(),
            reference_multiplier,
            reference_decimals,
            decision,
            confidence_ppm,
            agent_stake: quote.agent_stake,
            challenger_stake: quote.challenger_stake,
            evidence_hash,
            evidence_url,
            published_at_ns: U64(now),
            challenge_deadline_ns: U64(now
                .checked_add(CHALLENGE_WINDOW_NS)
                .expect("Challenge deadline overflow")),
            deadline_ns: U64(now
                .checked_add(PREDICTION_HORIZON_NS)
                .expect("Prediction deadline overflow")),
            challenger_account_id: None,
            challenged_at_ns: None,
            agent_stake_committed: false,
            settlement_status: "waiting".to_string(),
            settlement_request_id: None,
            settlement_requested_at_ns: None,
            settlement_price: None,
            outcome: None,
            settled_at_ns: None,
            payment: None,
        };
        self.predictions.insert(id, prediction.clone());
        self.active_prediction_id = Some(id);
        prediction
    }

    // Panics reject the payable call atomically, so NEAR returns an invalid take's deposit.
    #[payable]
    pub fn challenge_prediction(&mut self, prediction_id: U64) -> Prediction {
        let challenger = env::predecessor_account_id();
        require!(
            challenger == env::signer_account_id(),
            "A challenger must call directly from their own account"
        );
        require!(
            challenger != env::current_account_id(),
            "Reckon cannot challenge its own prediction"
        );
        require!(
            self.active_prediction_id == Some(prediction_id.0),
            "This prediction is not the active challenge"
        );

        let mut prediction = self
            .predictions
            .get(&prediction_id.0)
            .cloned()
            .expect("Prediction does not exist");
        require!(
            prediction.challenger_account_id.is_none(),
            "The challenger position is already taken"
        );
        let now = env::block_timestamp();
        require!(
            now < prediction.challenge_deadline_ns.0,
            "The challenge window has closed"
        );
        require!(
            env::attached_deposit().as_yoctonear() == prediction.challenger_stake.0,
            "Attached deposit must exactly match the quoted challenger stake"
        );

        self.accrue_at(now);
        require!(!self.dead, "Reckon is permanently dead");
        require!(
            prediction.agent_stake.0 <= self.spendable,
            "Reckon no longer has sufficient spendable bankroll"
        );
        let current_risk_cap =
            U256::from(self.spendable) * U256::from(MAX_AGENT_RISK_BPS) / U256::from(BASIS_POINTS);
        require!(
            U256::from(prediction.agent_stake.0) <= current_risk_cap,
            "The quoted agent stake exceeds the current risk cap"
        );

        self.spendable -= prediction.agent_stake.0;
        self.committed_bankroll = self
            .committed_bankroll
            .checked_add(prediction.agent_stake.0)
            .expect("Committed bankroll overflow");
        self.challenger_custody = self
            .challenger_custody
            .checked_add(prediction.challenger_stake.0)
            .expect("Challenger custody overflow");
        prediction.challenger_account_id = Some(challenger.to_string());
        prediction.challenged_at_ns = Some(U64(now));
        prediction.agent_stake_committed = true;
        self.predictions.insert(prediction_id.0, prediction.clone());
        prediction
    }

    /// Start the sole oracle request for this prediction after its published deadline.
    pub fn request_settlement(&mut self, prediction_id: U64) -> Promise {
        require!(
            self.active_prediction_id == Some(prediction_id.0),
            "This prediction is not awaiting settlement"
        );
        let mut prediction = self
            .predictions
            .get(&prediction_id.0)
            .cloned()
            .expect("Prediction does not exist");
        let now = env::block_timestamp();
        let settlement_cutoff = prediction
            .deadline_ns
            .0
            .checked_add(SETTLEMENT_WINDOW_NS)
            .expect("Settlement cutoff overflow");
        require!(
            now >= prediction.deadline_ns.0,
            "Prediction deadline has not passed"
        );
        require!(now < settlement_cutoff, "Settlement window has closed");
        require!(
            prediction.settlement_request_id.is_none(),
            "An oracle request is already pending"
        );

        let request_sequence = self.next_oracle_request_id;
        self.next_oracle_request_id = request_sequence
            .checked_add(1)
            .expect("Oracle request id overflow");
        let request_id = format!(
            "reckon:{}:{}:{}",
            env::current_account_id(),
            prediction_id.0,
            request_sequence
        );
        prediction.settlement_status = "observing".to_string();
        prediction.settlement_request_id = Some(request_id.clone());
        prediction.settlement_requested_at_ns = Some(U64(now));
        self.predictions.insert(prediction_id.0, prediction);

        let args = serde_json::json!({
            "receiver_id": env::current_account_id(),
            "asset_ids": [ORACLE_ASSET_ID],
            "msg": request_id,
            "resource_limits": null
        });
        Promise::new(self.oracle_account_id.clone()).function_call(
            "oracle_call".to_string(),
            serde_json::to_vec(&args).expect("Serialize oracle request"),
            NearToken::from_yoctonear(ORACLE_REQUEST_DEPOSIT),
            ORACLE_REQUEST_GAS,
        )
    }

    /// The declared oracle calls this method with its response and the exact request identity.
    pub fn oracle_on_call(
        &mut self,
        sender_id: AccountId,
        data: Value,
        msg: String,
    ) -> PromiseOrValue<bool> {
        require!(
            env::predecessor_account_id() == self.oracle_account_id,
            "Unexpected oracle provider"
        );
        require!(
            sender_id == env::current_account_id(),
            "Oracle response is for a different receiver"
        );
        let prediction_id = self
            .active_prediction_id
            .expect("No prediction is awaiting an oracle response");
        let mut prediction = self
            .predictions
            .get(&prediction_id)
            .cloned()
            .expect("Prediction does not exist");
        require!(
            prediction.settlement_status == "observing"
                && prediction.settlement_request_id.as_deref() == Some(msg.as_str()),
            "Oracle request identity does not match"
        );

        let now = env::block_timestamp();
        let cutoff = prediction
            .deadline_ns
            .0
            .checked_add(SETTLEMENT_WINDOW_NS)
            .expect("Settlement cutoff overflow");
        require!(
            now <= cutoff,
            "Oracle response arrived after the settlement window"
        );
        let requested_at = prediction
            .settlement_requested_at_ns
            .expect("Missing oracle request timestamp")
            .0;
        let price = validate_oracle_data(&data, now, requested_at)
            .expect("Oracle response is malformed, stale, or unusable");
        let outcome = if price_above(
            &price,
            prediction.reference_multiplier.0,
            prediction.reference_decimals,
        ) {
            "yes"
        } else {
            "no"
        };

        self.accrue_at(now);
        self.valid_outcomes = self
            .valid_outcomes
            .checked_add(1)
            .expect("Outcome count overflow");
        if outcome == prediction.decision {
            self.correct_outcomes = self
                .correct_outcomes
                .checked_add(1)
                .expect("Correct outcome count overflow");
        }
        prediction.settlement_status = "resolved".to_string();
        prediction.settlement_price = Some(price);
        prediction.outcome = Some(outcome.to_string());
        prediction.settled_at_ns = Some(U64(now));
        prediction.agent_stake_committed = false;

        if prediction.challenger_account_id.is_some() {
            self.committed_bankroll = self
                .committed_bankroll
                .checked_sub(prediction.agent_stake.0)
                .expect("Committed bankroll underflow");
            self.challenger_custody = self
                .challenger_custody
                .checked_sub(prediction.challenger_stake.0)
                .expect("Challenger custody underflow");
            if outcome == prediction.decision {
                if self.dead {
                    self.retired = self
                        .retired
                        .checked_add(prediction.agent_stake.0)
                        .and_then(|amount| amount.checked_add(prediction.challenger_stake.0))
                        .expect("Retired bankroll overflow");
                } else {
                    self.spendable = self
                        .spendable
                        .checked_add(prediction.agent_stake.0)
                        .and_then(|amount| amount.checked_add(prediction.challenger_stake.0))
                        .expect("Spendable bankroll overflow");
                }
            } else {
                prediction.payment = Some(PaymentLiability {
                    beneficiary_account_id: prediction
                        .challenger_account_id
                        .clone()
                        .expect("Missing challenger account"),
                    amount: U128(
                        prediction
                            .agent_stake
                            .0
                            .checked_add(prediction.challenger_stake.0)
                            .expect("Payout amount overflow"),
                    ),
                    status: "pending".to_string(),
                    transfer_in_flight: false,
                });
            }
        }

        self.active_prediction_id = None;
        self.predictions.insert(prediction_id, prediction);
        if let Some(payout) = self.start_payment_transfer(prediction_id) {
            PromiseOrValue::Promise(payout)
        } else {
            PromiseOrValue::Value(true)
        }
    }

    /// After the full request window, safely void a round that has no valid observation.
    pub fn void_unsettled_prediction(&mut self, prediction_id: U64) -> PromiseOrValue<bool> {
        require!(
            self.active_prediction_id == Some(prediction_id.0),
            "This prediction is not awaiting settlement"
        );
        let mut prediction = self
            .predictions
            .get(&prediction_id.0)
            .cloned()
            .expect("Prediction does not exist");
        let now = env::block_timestamp();
        let settlement_cutoff = prediction
            .deadline_ns
            .0
            .checked_add(SETTLEMENT_WINDOW_NS)
            .expect("Settlement cutoff overflow");
        require!(now >= settlement_cutoff, "Settlement window is still open");
        self.accrue_at(now);

        if prediction.agent_stake_committed {
            self.committed_bankroll = self
                .committed_bankroll
                .checked_sub(prediction.agent_stake.0)
                .expect("Committed bankroll underflow");
            if self.dead {
                self.retired = self
                    .retired
                    .checked_add(prediction.agent_stake.0)
                    .expect("Retired bankroll overflow");
            } else {
                self.spendable = self
                    .spendable
                    .checked_add(prediction.agent_stake.0)
                    .expect("Spendable bankroll overflow");
            }
            self.challenger_custody = self
                .challenger_custody
                .checked_sub(prediction.challenger_stake.0)
                .expect("Challenger custody underflow");
            prediction.payment = Some(PaymentLiability {
                beneficiary_account_id: prediction
                    .challenger_account_id
                    .clone()
                    .expect("Missing challenger account"),
                amount: prediction.challenger_stake,
                status: "pending".to_string(),
                transfer_in_flight: false,
            });
        }
        prediction.agent_stake_committed = false;
        prediction.settlement_status = "void".to_string();
        prediction.outcome = Some("void".to_string());
        prediction.settled_at_ns = Some(U64(now));
        self.active_prediction_id = None;
        self.predictions.insert(prediction_id.0, prediction);
        if let Some(refund) = self.start_payment_transfer(prediction_id.0) {
            PromiseOrValue::Promise(refund)
        } else {
            PromiseOrValue::Value(true)
        }
    }

    #[private]
    pub fn on_payment_complete(&mut self, prediction_id: U64) -> bool {
        let mut prediction = self
            .predictions
            .get(&prediction_id.0)
            .cloned()
            .expect("Prediction does not exist");
        let mut payment = prediction
            .payment
            .expect("Prediction has no payment liability");
        require!(
            payment.status == "pending" && payment.transfer_in_flight,
            "Payment receipt does not match a pending transfer"
        );
        let succeeded = env::promise_result_checked(0, 1_024).is_ok();
        payment.transfer_in_flight = false;
        if succeeded {
            payment.status = "paid".to_string();
        }
        prediction.payment = Some(payment);
        self.predictions.insert(prediction_id.0, prediction);
        succeeded
    }

    pub fn active_prediction(&self) -> Option<Prediction> {
        self.active_prediction_id
            .and_then(|id| self.predictions.get(&id).cloned())
    }

    pub fn get_prediction(&self, id: U64) -> Option<Prediction> {
        self.predictions.get(&id.0).cloned()
    }

    pub fn prediction_summary(&self) -> PredictionSummary {
        PredictionSummary {
            published: U64(self.next_prediction_id.saturating_sub(1)),
            valid_outcomes: U64(self.valid_outcomes),
            correct_outcomes: U64(self.correct_outcomes),
        }
    }

    pub fn list_predictions(&self, start_id: U64, limit: U64) -> Vec<Prediction> {
        let mut id = start_id.0.max(1);
        let limit = limit.0.min(MAX_PREDICTION_PAGE_SIZE);
        let mut page = Vec::with_capacity(limit as usize);
        while id < self.next_prediction_id && page.len() < limit as usize {
            if let Some(prediction) = self.predictions.get(&id) {
                page.push(prediction.clone());
            }
            id = id.saturating_add(1);
        }
        page
    }
}

impl Reckon {
    fn start_payment_transfer(&mut self, prediction_id: u64) -> Option<Promise> {
        let mut prediction = self.predictions.get(&prediction_id).cloned()?;
        let mut payment = prediction.payment.clone()?;
        if payment.status != "pending" || payment.transfer_in_flight {
            return None;
        }
        payment.transfer_in_flight = true;
        let beneficiary: AccountId = payment
            .beneficiary_account_id
            .parse()
            .expect("Invalid payment beneficiary");
        let amount = payment.amount.0;
        prediction.payment = Some(payment);
        self.predictions.insert(prediction_id, prediction);

        let callback_args = serde_json::to_vec(&serde_json::json!({
            "prediction_id": prediction_id.to_string()
        }))
        .expect("Serialize payment callback");
        Some(
            Promise::new(beneficiary)
                .transfer(NearToken::from_yoctonear(amount))
                .then(Promise::new(env::current_account_id()).function_call(
                    "on_payment_complete".to_string(),
                    callback_args,
                    NearToken::from_yoctonear(0),
                    PAYMENT_CALLBACK_GAS,
                )),
        )
    }

    fn checked_quote(&self, confidence_ppm: u32, now: u64) -> PredictionQuote {
        require!(
            (MIN_CONFIDENCE_PPM..=MAX_CONFIDENCE_PPM).contains(&confidence_ppm),
            "Prediction confidence is outside the supported range"
        );
        let challenge_closes_at = now
            .checked_add(CHALLENGE_WINDOW_NS)
            .expect("Challenge deadline overflow");
        let (spendable_at_close, _, _, dead_at_close) = self.project(challenge_closes_at);
        require!(
            !dead_at_close,
            "Reckon will be dead before the challenge window closes"
        );

        // Reserve against upkeep through the normal 30-second take window before applying 2%.
        let agent_stake = (U256::from(spendable_at_close) * U256::from(MAX_AGENT_RISK_BPS)
            / U256::from(BASIS_POINTS))
        .as_u128();
        require!(
            agent_stake >= MIN_AGENT_STAKE,
            "Spendable bankroll is below the minimum agent stake"
        );

        // Round the rational fair-odds amount to the nearest yoctoNEAR, half upward.
        let confidence = U256::from(confidence_ppm);
        let numerator = U256::from(agent_stake) * U256::from(CONFIDENCE_SCALE - confidence_ppm);
        let challenger_stake = ((numerator + confidence / U256::from(2u8)) / confidence).as_u128();
        require!(
            challenger_stake >= MIN_CHALLENGER_STAKE,
            "Fair-odds challenger stake is below the minimum"
        );

        PredictionQuote {
            confidence_ppm,
            agent_stake: U128(agent_stake),
            challenger_stake: U128(challenger_stake),
            minimum_agent_stake: U128(MIN_AGENT_STAKE),
            minimum_challenger_stake: U128(MIN_CHALLENGER_STAKE),
            confidence_scale: CONFIDENCE_SCALE,
        }
    }

    fn accrue_at(&mut self, now: u64) {
        let (spendable, retired, fractional, dead) = self.project(now);
        self.spendable = spendable;
        self.retired = retired;
        self.fractional = fractional;
        self.dead = dead;
        self.last_accrual_ns = now;
    }

    fn project(&self, now: u64) -> (u128, u128, u128, bool) {
        if self.dead {
            return (self.spendable, self.retired, self.fractional, true);
        }
        let elapsed = now.saturating_sub(self.last_accrual_ns);
        let charge =
            U256::from(self.initial_bankroll) * U256::from(elapsed) + U256::from(self.fractional);
        let whole = charge / U256::from(self.idle_life_ns);
        if whole >= U256::from(self.spendable) {
            return (0, self.retired + self.spendable, 0, true);
        }
        let whole = whole.as_u128();
        (
            self.spendable - whole,
            self.retired + whole,
            (charge % U256::from(self.idle_life_ns)).as_u128(),
            false,
        )
    }
}

fn validate_oracle_data(data: &Value, now: u64, requested_at: u64) -> Option<SettlementPrice> {
    let response = data.as_object()?;
    if response.len() != 3 {
        return None;
    }
    let response_timestamp_ns = response.get("timestamp")?.as_str()?.parse::<u64>().ok()?;
    let provider_recency_seconds = response.get("recency_duration_sec")?.as_u64()?;
    if provider_recency_seconds == 0
        || provider_recency_seconds > MAX_ORACLE_RECENCY_SECONDS
        || response_timestamp_ns < requested_at
        || response_timestamp_ns > now
        || now.saturating_sub(response_timestamp_ns) > MAX_ORACLE_RESPONSE_AGE_NS
    {
        return None;
    }

    let prices = response.get("prices")?.as_array()?;
    if prices.len() != 1 {
        return None;
    }
    let entry = prices[0].as_object()?;
    if entry.len() != 2 || entry.get("asset_id")?.as_str()? != ORACLE_ASSET_ID {
        return None;
    }
    let price = entry.get("price")?.as_object()?;
    if price.len() != 2 {
        return None;
    }
    let multiplier = price.get("multiplier")?.as_str()?.parse::<u128>().ok()?;
    let decimals = u8::try_from(price.get("decimals")?.as_u64()?).ok()?;
    if multiplier == 0 || decimals > 24 {
        return None;
    }

    Some(SettlementPrice {
        multiplier: U128(multiplier),
        decimals,
        response_timestamp_ns: U64(response_timestamp_ns),
        provider_recency_seconds,
    })
}

fn price_above(
    price: &SettlementPrice,
    reference_multiplier: u128,
    reference_decimals: u8,
) -> bool {
    let common_decimals = price.decimals.max(reference_decimals);
    let price_value =
        U256::from(price.multiplier.0) * power_of_ten(common_decimals - price.decimals);
    let reference_value =
        U256::from(reference_multiplier) * power_of_ten(common_decimals - reference_decimals);
    price_value > reference_value
}

fn power_of_ten(exponent: u8) -> U256 {
    let mut result = U256::one();
    for _ in 0..exponent {
        result *= U256::from(10u8);
    }
    result
}
