# Use an explicitly bounded settlement-time price

The inspected testnet oracle provides current prices rather than historical prices at a selected timestamp. Reckon therefore resolves a prediction using the price returned by the first successful oracle request initiated after its deadline and completed within a short settlement window, with a void and challenger refund if no valid result arrives in time. The rule is visible before staking and discloses that caller timing and source caching can affect outcomes, trading exact-time measurement for a simpler live settlement path that still requires a feasibility check.

Accepted by the user during the grill-with-docs interview on 13 November 2026, IST. The settlement window length and valid-response criteria remain open. This decision does not establish that paid refresh works or prove an external price observation timestamp.
