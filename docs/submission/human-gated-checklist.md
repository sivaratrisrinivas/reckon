# Final checklist: what remains human-gated

Status: **every row below is NOT DONE.** Drafts in `docs/submission/` are preparation, not completion of any gated action. An agent may run a row only after the human approves that specific row in the current session, and some rows only the human can do.

Dates and times: target submission 14 November 2026 22:00 IST; official deadline 15 November 2026 05:29 IST (14 November 23:59 UTC). Details: `event-requirements.md`. Steps: `launch-runbook.md`.

Legend for "Who": H = human only; H+A = human approves, agent may execute with the human present; A = agent may do it without approval once its inputs exist (these rows are listed because they are not finished, not because they are gated).

## A. Verification still pending (not gated, blocked on issues #10, #11, #12)

| # | Item | Who | Blocked by | Evidence to record | Status |
| --- | --- | --- | --- | --- | --- |
| A1 | Merge #10, #11, #12 into the release candidate; clean `git status`; note the commit SHA | A | #10, #11, #12 | SHA | NOT DONE |
| A2 | README audit against merged code and tests (`readme-audit.md` was deliberately not written here) | A | A1 | the audit, with fixes applied | NOT DONE |
| A3 | Full acceptance run from a clean clone using only the README (`launch-runbook.md` 1.3) | A or H | A1 | command log, results | NOT DONE |
| A4 | Compare README claims with the actual browser and the clean local demonstration | A or H | A1 | notes per claim | NOT DONE |
| A5 | CI green on the merged commit (requires a push) | H | A1 | CI run link | NOT DONE |

## B. Repository and README (human decisions inside)

| # | Item | Who | Blocked by | Status |
| --- | --- | --- | --- | --- |
| B1 | Decide the exact AI-assistance disclosure wording (tools, extent, human review) | H | none | NOT DONE |
| B2 | Confirm in the README that no pre-hackathon baseline code exists (first commit is 12 November 2026) and whether any second project exists | H | none | NOT DONE |
| B3 | Confirm the copyright holder wording in `LICENSE` (currently "Reckon contributors") | H | none | NOT DONE |
| B4 | Decide whether to add the `hackathon-submission` tag (the rules name it; `pre-hackathon` is unnecessary if no baseline exists) | H | none | NOT DONE |
| B5 | Authorise each push to the remote | H | A2 | NOT DONE |
| B6 | Confirm the repository is public in a signed-out window (a read-only `gh repo view` during this preparation on 14 November reported it as public with an MIT license; any visibility change needs the human) | H | none | NOT DONE |
| B7 | Read the full diff of commit authorship and history for anything private before it is public (no secrets or addresses were found by the searches recorded in `license-dependency-check.md`; those searches are not exhaustive) | H | none | NOT DONE |

## C. Testnet agent and the irreversible lock (Path A only)

| # | Item | Who | Blocked by | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | Decision D1: Path A (testnet) or Path B (local sandbox plus video), by 20:00 IST | H | A1, #12 | decision note | NOT DONE |
| C2 | Create final agent account and keeper account; generate and store the restricted key securely | H | C1 | account ids, public keys | NOT DONE |
| C3 | Fund both accounts | H | C2 | balances | NOT DONE |
| C4 | Deploy and initialize the final contract in one transaction | H+A | C3, measured settings from #12 | tx hash, code hash equality | NOT DONE |
| C5 | Add the restricted `publish_prediction` key with the measured allowance | H+A | C4 | key list (CLI and RPC) | NOT DONE |
| C6 | Negative tests with the restricted key; authorization probe; allowance before and after | H+A | C5 | saved outputs | NOT DONE |
| C7 | **Explicit human approval of the lock card and the approval statement** (`launch-runbook.md` 8.4, with the real account id) | **H only** | C6, A3 | approval in the human's own words | **NOT GIVEN** |
| C8 | Delete all full-access keys in one transaction | H+A after C7 | C7 | tx hash, key list showing one key | NOT DONE |
| C9 | Demonstrate that the old key fails: transfer, add key, deploy | H+A | C8 | three saved failures | NOT DONE |
| C10 | Preserve deployed-code and key evidence in a sanitized summary | H+A | C8 | evidence folder | NOT DONE |

The lock is not started under Path B, and under Path B the README, post, and video must not imply a locked agent.

## D. Hosting and durability (Path A; the rules treat a hosted demo as optional)

| # | Item | Who | Blocked by | Status |
| --- | --- | --- | --- | --- |
| D1 | Choose a host and a spend limit (new decision; ADR 0005 covers only evidence storage, up to 5 USD per month) | H | C1 | NOT DONE |
| D2 | Create the host project and set secrets in its secret store (model key, Blob token, restricted key, keeper key) | H | D1 | NOT DONE |
| D3 | Confirm the Vercel Blob project is Hobby, public, no expiry | H | none | NOT DONE |
| D4 | Deploy; verify public links from a clean profile and a phone; verify phone layout | H+A | D2, C8 | NOT DONE |
| D5 | One complete live moment on the final deployment, with costs | H+A | D4 | NOT DONE |
| D6 | Export the evidence archive and publish it as a GitHub Release (ADR 0005 launch checklist) | H | D5 | NOT DONE |
| D7 | Calendar: re-verify links on 25 November; archive and decide on retiring hosting; revoke API and Blob tokens after judging | H | none | NOT DONE |

## E. Recording and publication

| # | Item | Who | Blocked by | Status |
| --- | --- | --- | --- | --- |
| E1 | Record the full uncut backup demonstration before final polish | H+A | A3 (Path B) or D5 (Path A) | NOT DONE |
| E2 | Edit the hero cut from a copy; check against `demo-script.md` | H | E1 | NOT DONE |
| E3 | Upload the video and attach it to the post (any public upload is the human's) | H | E2 | NOT DONE |
| E4 | Publish the X post with the phrase "built at NEAR HACKATHON", `@NEARProtocol`, `#NEARHackathon` | **H only** | E3 | NOT DONE |
| E5 | Send the post URL back for the payload | H | E4 | NOT DONE |

## F. Submission (one time only)

| # | Item | Who | Blocked by | Status |
| --- | --- | --- | --- | --- |
| F1 | Re-read the live `HACKATHON.md` immediately before submitting | H | none | NOT DONE |
| F2 | Supply personal values in the current session: lead name, email, team size, tracks, mainnet payout account, consent | **H only** | none | NOT DONE |
| F3 | Run the offline pre-check on the private payload file | H+A | F2, E5 | NOT DONE |
| F4 | Explicit confirmation of the exact JSON | **H only** | F3 | **NOT GIVEN** |
| F5 | Send one submission (API or form, not both); record status and time | H+A after F4 | F4 | NOT DONE |
| F6 | Corrections only through the request-changes page | H | F5 | NOT APPLICABLE YET |

## G. What agents must not do without a row above being approved

Deploy anything; create or fund testnet or mainnet accounts; add or delete keys; push; change repository visibility; host anything; publish or post anything; submit anything; contact the organizers or anyone else; invent a name, email, payout account, track, team size, or consent; run `RECKON_PROVIDER_MODE=live`; spend funds or model credit.

## H. Open risks to carry into the day

1. At commit `e8e5ae4` the service and browser are local-sandbox only and the interface hard-codes local labels. A hosted testnet experience depends on work outside this branch (see `launch-runbook.md` section 0 and 1.4).
2. The live initializer has no receipt-proof configuration, so a testnet payment whose callback never arrives cannot be reconciled on chain.
3. The wall-clock budget is short: 18:40 to 22:00 IST is 3 h 20 min against the six-hour verification reserve the specification asks for. Path B is the safer use of that time if #12's rehearsal is incomplete.
4. The local forecast cooldown and daily model budget are per machine and stored on local disk; a hosted instance would reset them on redeploy and any visitor can spend the daily budget.
5. The README's setup needs pinned toolchains and administrator rights for browser dependencies; an automated screening check may struggle with it (the later README pass should address this).
