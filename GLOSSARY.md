# Reckon

Reckon is a prediction game in which an agent stakes its own bankroll on its forecasts and permanently loses the ability to make new forecasts when its spendable funds run out.

## Language

**Bankroll**:
The agent's funds available for upkeep and stakes, including funds committed to unresolved challenges.
_Avoid_: Account balance, treasury

**Spendable bankroll**:
The portion of the bankroll available for new commitments and upkeep.
_Avoid_: Account balance

**Challenger**:
A participant who stakes funds on the outcome opposite to the agent's prediction. Each prediction can have one challenger.

**Prediction**:
A forecast the agent chooses within a predefined question format and horizon, with a stated confidence and stakes determined by a disclosed rule.
_Avoid_: Arbitrary model-generated claim

**Confidence**:
The probability the agent assigns to its prediction being correct, rather than a guarantee of accuracy.

**Fair odds**:
A pairing of stakes with zero expected betting profit or loss at the agent's stated confidence, before upkeep and monetary rounding.

**Void prediction**:
A published prediction without a valid resolved outcome, excluded from accuracy calculations.

**Upkeep**:
A configured recurring charge against the agent's spendable bankroll, independent of actual AI compute bills.
_Avoid_: Metered compute cost, thinking cost

**Retired bankroll**:
Funds permanently removed from the agent's usable bankroll by upkeep, remaining in its account without funding new stakes or revival.
_Avoid_: Burned tokens, sink payment

**Death**:
The permanent end of the agent's ability to make new predictions or accept new challenges after its spendable funds run out. Existing challenges still settle, and late winnings or unsolicited funds cannot revive it.
_Avoid_: Pause, temporary shutdown
