# Bound the prediction key's lifetime gas allowance

Restricting a key to one method does not prevent spending gas on permitted calls. Reckon therefore uses a finite lifetime allowance sized from measured costs with headroom and backed by an operational reserve, bounding this authority instead of granting unlimited gas access. Allowance exhaustion can stop publication before bankroll death and cannot be reversed by adding account funds; the UI must distinguish that operational failure from death, and other callers must still be able to settle existing predictions.

Accepted by the user during the grill-with-docs interview on 13 November 2026, IST. The exact allowance is a measured pre-lock parameter, not a promise of unlimited service life.
