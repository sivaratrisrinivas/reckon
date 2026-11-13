use near_sdk::{
    env,
    json_types::{U128, U64},
    near, require,
    store::LookupMap,
    BorshStorageKey, PanicOnDefault,
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
const MAX_PREDICTION_PAGE_SIZE: u64 = 50;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Reckon {
    initial_bankroll: u128,
    spendable: u128,
    retired: u128,
    operational_reserve: u128,
    idle_life_ns: u64,
    last_accrual_ns: u64,
    fractional: u128,
    dead: bool,
    prediction_public_key: String,
    next_prediction_id: u64,
    active_prediction_id: Option<u64>,
    predictions: LookupMap<u64, Prediction>,
}

#[near(serializers = [json])]
pub struct Life {
    initial_bankroll: U128,
    spendable_bankroll: U128,
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
    published_at_ns: U64,
    challenge_deadline_ns: U64,
    deadline_ns: U64,
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
        )
    }

    #[init]
    pub fn new(
        initial_bankroll: U128,
        operational_reserve: U128,
        idle_life_ns: U64,
        prediction_public_key: String,
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
            retired: 0,
            operational_reserve: operational_reserve.0,
            idle_life_ns: idle_life_ns.0,
            last_accrual_ns: env::block_timestamp(),
            fractional: 0,
            dead: false,
            prediction_public_key,
            next_prediction_id: 1,
            active_prediction_id: None,
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
            published_at_ns: U64(now),
            challenge_deadline_ns: U64(now
                .checked_add(CHALLENGE_WINDOW_NS)
                .expect("Challenge deadline overflow")),
            deadline_ns: U64(now
                .checked_add(PREDICTION_HORIZON_NS)
                .expect("Prediction deadline overflow")),
        };
        self.predictions.insert(id, prediction.clone());
        self.active_prediction_id = Some(id);
        prediction
    }

    pub fn active_prediction(&self) -> Option<Prediction> {
        self.active_prediction_id
            .and_then(|id| self.predictions.get(&id).cloned())
    }

    pub fn get_prediction(&self, id: U64) -> Option<Prediction> {
        self.predictions.get(&id.0).cloned()
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
