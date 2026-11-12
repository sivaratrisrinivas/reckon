use near_sdk::{
    env,
    json_types::{U128, U64},
    near, require, PanicOnDefault,
};
use uint::construct_uint;

construct_uint! { struct U256(4); }

/// The internal accounting is independent of the account's physical balance.
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

#[near]
impl Reckon {
    #[init]
    pub fn new(initial_bankroll: U128, operational_reserve: U128, idle_life_ns: U64) -> Self {
        require!(
            initial_bankroll.0 > 0 && idle_life_ns.0 > 0,
            "Bankroll and idle life must be positive"
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
        let now = env::block_timestamp();
        let (spendable, retired, fractional, dead) = self.project(now);
        self.spendable = spendable;
        self.retired = retired;
        self.fractional = fractional;
        self.dead = dead;
        self.last_accrual_ns = now;
    }
}

impl Reckon {
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
