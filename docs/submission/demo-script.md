# Demo video script and shot list (draft)

Status: **draft only; no video has been recorded, edited, uploaded, or posted.** Placeholders in angle brackets are for the human. The on-screen text quoted below was read from `public/index.html` and `public/app.js` at commit `e8e5ae4`; issue #10 may change wording, so re-check each quoted string against the merged interface before recording.

## What the event asks for

The live rules (see `event-requirements.md`) say the demo should show one complete moment, from a real user action to a visible result, and skip long introductions, architecture slides, and setup. No video length is stated. The post must carry the video, and screenshots alone are risky if judges cannot open a hosted demo.

Recommended deliverables:

1. **Hero cut, 75 to 100 seconds**, for the X post.
2. **Backup demonstration, uncut, about 6 to 8 minutes**, recorded first (see `launch-runbook.md` section 12). It is the safety copy and the source for the hero cut.

## Truth rules for the script

- Say only what the recording shows. The README's limits apply to the voice-over as much as to the text.
- The five-minute prediction horizon is real wall-clock time in every mode. If the wait is cut, show a card ("Five minutes skipped") and never present the cut as real time.
- The on-screen environment label must stay visible whenever money, stakes, or results are shown: `LOCAL SANDBOX · TEST MONEY` in the local build; the testnet equivalent must exist in the interface before Variant A is recorded.
- Fixture mode shows `FORECAST INPUTS · SCRIPTED LOCAL FIXTURES`; live mode shows `FORECAST INPUTS · LIVE PROVIDERS`. Do not describe scripted prices or a scripted model response as live forecasting skill.
- Do not say "locked", "immutable agent", or "no owner" unless the lock transaction and the failed-old-key evidence exist (`launch-runbook.md` sections 8 and 9).
- Do not claim the oracle price is an exact-expiry price. The app's own rule text says it is a bounded settlement-time observation.
- Do not show secrets, keys, tokens, `.env`, wallet recovery phrases, account recovery screens, or the `/api/wallet` response (it contains the disposable sandbox key).
- AI disclosure: if an on-screen note is wanted, `<HUMAN TO SUPPLY: truthful wording about AI assistance, matching the README>`.

## Variant selector

- **Variant B, local sandbox** (default if no verified testnet deployment exists). The environment is the local NEAR sandbox; the wallet is an ephemeral sandbox key; play money.
- **Variant A, hosted testnet** only if `launch-runbook.md` section 11 passed on the final deployment. Replace "local sandbox wallet" with the real wallet flow, show the real testnet explorer for one transaction, and use the live app URL.

## Hero cut shot list (Variant B)

| # | Time | On screen | Voice-over (draft) | Truth source |
| --- | --- | --- | --- | --- |
| 1 | 0:00 to 0:06 | Landing view: headline "An AI that pays when it is wrong." with `LOCAL SANDBOX · TEST MONEY` in the header | "This AI bets its own money on its forecasts. When it runs out, it dies for good." | `public/index.html` intro; ADR 0001 |
| 2 | 0:06 to 0:15 | Life meter and the five-way bankroll partition: spendable, committed, challenger custody, retired, operational reserve | "It has a finite bankroll. Upkeep, a configured rule and not an invoice, retires it over time." | `public/index.html` partition and note; ADR 0004 |
| 3 | 0:15 to 0:27 | Click **Ask Reckon**; status "Thinking…"; the prediction appears with side, confidence, stakes, challenge deadline, prediction deadline, model identity, and the evidence fingerprint | "One fixed question: will NEAR/USD be strictly above the reference price in five minutes? A model picks a side and a confidence, or abstains. Code sets fair odds and caps its stake at two percent." | `README.md` forecasts section; `contract/src/lib.rs` quote |
| 4 | 0:27 to 0:42 | Click **Challenge Prediction**; the approval dialog shows side, stake, potential return, deadline, network, and the loss-risk line; click **Approve stake in local wallet**; the transaction state moves from signing to confirmed | "I take the other side. The stake, the return, and the risk are on screen before I sign. Only a confirmed on-chain position counts." | `public/index.html` dialog; `public/app.js` transaction states |
| 5 | 0:42 to 0:50 | Card: "Five minutes skipped" over the waiting state ("The prediction resolves automatically after its five-minute deadline. No result-reveal action is needed.") | "Settlement is automatic." | `public/app.js` settlement state |
| 6 | 0:50 to 1:05 | Result: "Resolved YES/NO ..." with the payment line; the bankroll partition changes; payment shown as pending until "Payment receipt confirmed on chain" | "The oracle contract sets the result. The payout is called paid only after the transfer receipt succeeds." | `public/app.js` payment states; `README.md` payments |
| 7 | 1:05 to 1:15 | Click **Download evidence snapshot**; show the SHA-256 fingerprint next to the on-chain record | "The evidence snapshot is public. The fingerprint detects edits. It does not prove the model ran." | `public/index.html` limitation line; ADR 0005 |
| 8 | 1:15 to 1:28 | Only if issue #11 delivers: the accelerated simulated life reaching death, with its own label "SIMULATED" and "ACCELERATED" visible | "In a labelled, accelerated simulation, when its spendable funds run out, new predictions stop. Existing rounds still settle." | issue #11 output; ADR 0001 |
| 9 | 1:28 to 1:35 | Close card: `<REPO URL>` and the text "Local sandbox · play money · not audited". Question: "Would you bet against it?" | "Code and run steps are in the README. Would you bet against it?" | `README.md` |

If #11 does not deliver, drop shot 8. Do not substitute an unlabelled clip.

## Variant A changes (testnet, only if verified)

- Shot 1 shows the real network label and the final account id's explorer page.
- Shot 4 uses the real wallet's approval screen. Count wallet steps separately in the narration only if they were counted that way in the README.
- Shot 6 shows the live oracle and payout transactions in the explorer, with the real wait shown or honestly cut.
- Add one shot of the key list showing only the restricted `publish_prediction` key, and one of the failed old-key transfer, **only** if section 9 of the runbook was completed and approved by the human.

## Backup demonstration (uncut)

Record in this order, one take, with a visible clock:

1. Fresh start of the service (or the hosted page).
2. One complete round, including any abstentions or failures the system produces; do not retake just to avoid them.
3. The public record and the evidence download.
4. The README's run steps working on a clean checkout, if time allows.

Store the raw file and its checksum in two places. The hero cut is made from a copy.

## Recording and editing checklist

- [ ] Browser: clean profile, no bookmarks bar, notifications off, zoom at 100% or 125%, window about 1280 by 720 or larger. Record the screen with audio from a quiet room.
- [ ] Hide the terminal environment, shell history, `.env`, password-manager popups, and the clipboard.
- [ ] Every shown number is on screen long enough to read (at least 2 seconds). Captions on for accessibility; check that captions match the narration.
- [ ] Environment label, provider label, and the "play money" wording are visible in every shot that shows stakes or results.
- [ ] The time-skip card is visible for at least one second and says what it skips.
- [ ] No claim in the narration is stronger than the README. Re-read the README's trust and limits sections before export.
- [ ] Export a version that plays on a phone; verify it plays inside the X post before announcing.
- [ ] Narrator and any on-screen name: `<HUMAN TO SUPPLY, or none>`.
- [ ] Music or third-party footage: none, unless the human confirms the rights.
