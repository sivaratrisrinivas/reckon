# X post draft (human publishes)

Status: **draft only. Nothing has been posted.** The human writes, edits, and publishes the post from their own account and sends back its URL. Placeholders in angle brackets and `[HUMAN: ...]` must be replaced or deleted. Choose the variant that matches what is actually true on the day; do not edit a variant to claim more than the evidence shows.

## What the event rules require (re-read 14 November 2026; see `event-requirements.md`)

- The post must say the project was **built at NEAR HACKATHON**.
- It must tag `@NEARProtocol` and include `#NEARHackathon`. `@NearLegion` and `@NearBuilders` are optional.
- It must carry the demo video (preferred) or screenshots. Screenshots alone are risky if judges cannot open a hosted demo.
- The public URL of the post goes into the `demoUrl` field (300 characters or fewer).
- The source guidance for content: open with the user problem, show one complete action-to-result moment, say concretely what NEAR enables, end with demo and repository links and a specific question or request for feedback.

## Length

Character counts below treat each link as 23 characters, the way X counts links, and were computed, not estimated. A standard account allows 280 characters. If the account allows longer posts, the extra room is better spent on the reply posts than on the main post.

## Variant B (local sandbox, reproducible, labelled play money): 274 characters

Use this if no testnet deployment exists, or if the hosted testnet experience was not verified.

```
Built at NEAR HACKATHON: Reckon, an AI that stakes its own bankroll on NEAR/USD forecasts and dies for good when it runs out. Bet against it, watch a NEAR contract settle. Local sandbox demo. Code: <REPO URL> @NEARProtocol #NEARHackathon Would you challenge it?
```

Attach: `<HUMAN TO SUPPLY: final demo video file>`.

Reply 1 (272 characters) states what is real and what is simulated. Fill the bracket from the actual run and delete it if nothing applies:

```
What is real: the NEAR contract, bankroll, stakes, payouts and death run on a local NEAR sandbox with play money. What is simulated: [HUMAN: e.g. prices, oracle and model output are scripted fixtures]. Not on mainnet, not audited. Built with AI assistance, see the README.
```

## Variant A (hosted testnet experience): 275 characters

Use this **only** if section 11 of `launch-runbook.md` passed on the final deployment (public links verified, one complete live round captured). Add the app link as a second link only if it fits; a link counts as 23 characters.

```
Built at NEAR HACKATHON: Reckon, an AI that stakes its own bankroll on NEAR/USD forecasts and dies for good when it runs out. Bet against it, watch a NEAR contract settle. Testnet, play money. Code: <REPO URL> @NEARProtocol #NEARHackathon Would you challenge it?
```

Attach: `<HUMAN TO SUPPLY: final demo video file>`.

Reply 1 (258 characters). Keep only the statements that are true:

```
What is real: a NEAR testnet contract holding play money, with live [HUMAN: confirm each] market data, model and oracle. Not on mainnet, not audited, and the final account is permanently locked [HUMAN: only if true]. Built with AI assistance, see the README.
```

Reply with the live app link: `Try it: <APP URL>` (use only if the hosted link was verified from a phone and a clean browser profile).

## Optional second reply (limits, 246 characters)

```
Limits: the settlement price is a bounded observation after the deadline, not an exact-expiry price. The evidence fingerprint detects edits; it does not prove the model ran. Details and limits are in the README. Questions and bug reports welcome.
```

## Optional amplification tags

Appending `@NearLegion @NearBuilders` is allowed. With a 23-character link, variant A with both tags would exceed 280 characters in the main post, so put the extra tags in a reply, or drop the closing question.

## Do not

- Do not call it a "mainnet", "live wagering", or "audited" product. The README says it has not been audited or deployed for real-money use.
- Do not say the agent is "locked" unless the lock transaction was completed and the failed-old-key evidence exists.
- Do not describe scripted prices or model output as live forecasts. Fixture mode is labelled as simulated everywhere in the app.
- Do not show secrets, keys, tokens, `.env`, or account recovery phrases in the attached video or in any screenshot.
- Do not state a deadline, prize, or ranking claim.
- The post's author, account handle, and any personal wording are the human's. Nothing here names a person.

## Before publishing (human checklist)

- [ ] The post contains the phrase "built at NEAR HACKATHON", `@NEARProtocol`, and `#NEARHackathon`.
- [ ] The video plays on the post and shows the labels in `demo-script.md`.
- [ ] The repository link opens signed out and the README matches what the video shows.
- [ ] The post is public (check in a signed-out window) and its URL is copied for the payload.
- [ ] The human, not an agent, pressed Post.
