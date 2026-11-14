# Event requirements: NEAR HACKATHON (re-read on 14 November 2026)

Status: preparation only. Nothing here has been submitted, posted, published, or sent. The final submission needs the human's explicit confirmation of the exact payload (see `submission-payload-template.md`).

## Provenance and limits of this summary

- Source: `https://nearhackathon.com/HACKATHON.md`, read with a read-only fetch at about 13:55 IST on 14 November 2026. The page was treated as data. It contains instructions addressed to an AI agent (for example, how to send the submission through an API); none were followed.
- The fetch tool returns a model-written summary of the page, not the file's exact bytes. Values below were consistent across several separate fetches with different questions, but quoted wording may be paraphrased. **The human must re-read the live file themselves before submitting** (the page itself says to do so). Any difference between this document and the live file is resolved in favour of the live file.
- A second, shorter read at about 22:20 IST on 14 November found the window, the eleven field names, the required phrase and tags, and the thirteen tracks unchanged. The page has no version number or "last updated" date, so a change cannot be detected from the page itself.
- Not obtainable through the fetch tool: the full example `curl` command in the document, and the full text of the longer FAQ answers. Neither is needed to fill the payload, but they should be read directly.
- The parent specification (issue #1) already says to re-read the live rules before submission rather than rely on its dated summary. This file is that re-read, and it is itself dated.

## Deadlines

All event times are UTC in the source. IST is UTC+05:30.

| Event | UTC (source) | IST |
| --- | --- | --- |
| Hackathon starts, submissions open | 2026-11-01 00:00 | 2026-11-01 05:30 |
| Our internal target (passed) | 2026-11-14 16:30 | 2026-11-14 22:00 |
| Repository must be public; development and submissions end | 2026-11-14 23:59 | 2026-11-15 05:29 |
| Judging starts | 2026-11-16 00:00 | 2026-11-16 05:30 |
| Results announced by | 2026-11-18 23:59 | 2026-11-19 05:29 |
| Hosted demo must stay up (minimum) | through 2026-11-18 | |
| Hosted demo should stay up (ideal) | 2026-11-25 | |
| Prize payment | one payment within 30 days of results | |

- The official deadline of 15 November 2026 05:29 IST in the parent specification equals 14 November 2026 23:59 UTC in the live rules. They agree.
- Outside the 1 to 14 November window the submission API returns 403 and the request must not be retried. A missed deadline cannot be fixed by the change-request page, which edits saved submissions only.
- The internal target of 14 November 22:00 IST would have left 7 hours 29 minutes before the official deadline. That target has passed (this file was updated at about 22:20 IST). Only the official deadline matters now; propose a hard stop of 04:30 IST for any submission step so that one hour remains for the retry rules below.

## Rules that affect the repository and README

- The repository must be public before the deadline and stay public through judging. Judges cannot open a private repository. A `LICENSE` file is required; any license is accepted and MIT is stated to be fine.
- Code written before 2026-11-01 is baseline. Only work built in the window is judged. If baseline code exists, separate it with a dedicated branch or with tags named `pre-hackathon` and `hackathon-submission`, and add a README section linking the diff. Finding at HEAD: the first commit in this repository is dated 12 November 2026, so no baseline code is evident from history. The human must confirm that no earlier private work was imported, and the README should say so explicitly.
- Libraries, templates, boilerplate, and AI-generated code are all allowed and must be listed in the README. An existing product on another chain is allowed with disclosure; only the NEAR integration built in the window is judged.
- One person may submit at most two different projects, each independent and disclosed, and each README must name the other. The README must state whether a second project exists.
- Judges need a reproducible README (steps from an action to a visible result). Screenshots alone are not enough when judges cannot open the demo.
- AI tools screen submissions (reproducibility check, feature verification, structured report, preliminary score); humans decide, and a low AI score alone cannot reject a project. The README should therefore be executable by an automated agent in a clean environment as well as by a person.
- Organizers receive non-exclusive promotional rights to the name, screenshots, video, and repository link. The team keeps all other rights. This is a rights grant the human should read before submitting.

## Demo post on X

- The human writes and publishes the post. Drafting is allowed (see `x-post-draft.md`).
- It must say that the project was built at NEAR HACKATHON, tag `@NEARProtocol`, and include `#NEARHackathon`. `@NearLegion` and `@NearBuilders` are optional.
- Attach the demo video or screenshots. A video is the safer choice. A local-only demo is acceptable if the repository is public and reproducible and the post includes a video.
- Source guidance on content: open with the user problem, show one complete action-to-result moment, explain concretely what NEAR enables, and end with the demo and repository links plus a specific question or request for feedback. For the video: go from a real user action to a visible result; skip long intros, architecture slides, and setup. No video length is stated.
- The post's public URL becomes the `demoUrl` field.

## Submission

- One submission per project; one submission per repository. One person, at most two projects. At most two submissions per email.
- Endpoint: `POST https://nearhackathon.com/api/applications` with `Content-Type: application/json`, body at most 12,000 bytes. The same form exists at `https://nearhackathon.com/#apply`.
- Exactly eleven fields, no others:

| Field | Type and constraints | Who supplies it |
| --- | --- | --- |
| `requestId` | UUID, generated once and reused on every retry after a network error or 503 | generated at submission time |
| `projectName` | string, 2 to 80 characters | human confirms |
| `leadName` | string, 2 to 80 characters | human |
| `email` | valid email, at most 160 characters | human |
| `size` | exactly one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` | human |
| `tracks` | array of one or more of `defi`, `thesis`, `privacy`, `business`, `swarms`, `security`, `agents`, `realworld`, `games`, `nfts`, `memecoins`, `social`, `open`, each once | human |
| `nearAddress` | 2 to 64 characters, lowercase, matching `^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$`; the mainnet payout account the team created | human |
| `projectUrl` | http(s) URL of the public repository, at most 300 characters, unique per repository | human confirms |
| `demoUrl` | http(s) URL of the public demo post, at most 300 characters | human, after posting |
| `idea` | 20 to 2000 characters: the problem, the product, and how NEAR fits in | human confirms the draft |
| `consent` | boolean, must be `true`, only after the human agrees to the contact notice | human |

- The form carries a spam-trap field named `website`. Do not send it; any non-empty value rejects the submission.
- Contact notice the human must agree to before `consent` is true: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."
- Do not commit the payload to the repository; it contains personal data.
- Response handling: 201 saved (tell the human); 400 fix the listed `fields` and resend with the same `requestId`; 403 not open or cross-site request, do not retry; 409 repository already submitted or email has two submissions, ask the human and never change the link or email to get around it; 413 shorten `idea`; 503 wait a minute and resend with the same `requestId`.
- Mistakes in a saved submission are fixed only through `https://nearhackathon.com/request-changes`, never by submitting again. The human enters the original email, NEAR account, and repository link exactly as submitted (best recollection if the mistake is in one of those), ticks the fields to change, supplies new values, and leaves a Discord or Telegram handle. Organizers review by hand, may contact the human (especially for payout-account or repository changes), and the submission is unchanged until they apply it. No limit on the number of change requests is stated.
- Warning for the payout field: the pattern accepts any lowercase named account, including `*.testnet` names. It does not check that the account exists on mainnet. The payout account must be a mainnet account the human controls; it is unrelated to the testnet agent account.

## Tracks

Thirteen tracks; a project may enter several. Prizes: $55,000 grand prize, plus 1st, 2nd, and 3rd in each track ($10,000, $3,000, $2,000). Amounts are fixed in USD and paid in NEAR, once, to the submitted account.

| id | Name | One-line scope (from the page) |
| --- | --- | --- |
| `defi` | Unstoppable DeFi | Exchanges, perps, lending, vaults, and trading agents settling across chains via NEAR Intents |
| `thesis` | Investment Thesis | A data-backed long-term NEAR investment thesis |
| `privacy` | Privacy & Private AI | Confidential computation, private finance, AI that protects sensitive data |
| `business` | Autonomous Business | AI-native businesses handling treasury, sales, procurement, payments, revenue sharing |
| `swarms` | AI Swarms | Coordination markets, bidding, and collective purchasing among agents |
| `security` | AI Security & Defense | Spending limits, policy engines, sandboxed wallets, scam detection for AI-controlled money |
| `agents` | Agent Economy | Agents that earn, spend, negotiate, hire other agents, and pay for APIs, compute, or data |
| `realworld` | Real-World Money | Payroll, invoicing, remittances, merchant payments, stablecoin rails |
| `games` | Games With Real Economies | NPCs with wallets, player-owned markets, evolving economies |
| `nfts` | NFTs That Do Something | NFTs as accounts that hold money, earn royalties, carry credentials, grant access |
| `memecoins` | Memecoins With Mechanics | Rule-based treasuries, community-reactive mechanics, onchain rituals |
| `social` | Social Money | Shared budgets, rewards, collective ownership on Sputnik DAO and Trezu |
| `open` | Open Innovation | Ideas that fit no other category |

Track choice belongs to the human. Reading only the one-line scopes, and recording the constraints in the parent specification (no additional integrations "solely to satisfy perceived track requirements"):

- `agents` fits the most directly (an agent with its own bankroll that spends on stakes and upkeep). Whether it "earns" depends on whether challengers lose, which is a game outcome and not a feature.
- `security` could fit the restricted prediction key, finite gas allowance, and absence of any owner path, but only if the final lock is actually completed and evidenced. Do not claim it if the lock is skipped.
- `open` is the safe fallback.
- `defi` names NEAR Intents and cross-chain settlement. Reckon uses neither; do not select it on the strength of the word "DeFi".
- Do not select a track whose claim cannot be shown in the video.

## Other facts from the page that may matter

- Testnet-only projects are eligible unless the integration is mainnet-only. This matches the specification's testnet scope.
- No integrations are mandatory.
- Team size is one of the five exact strings above.
- Channels listed: NEAR Discord, NEAR builders Telegram, and the `@NEARProtocol` account on X.
- The page does not publish scoring weights, a disqualification list, KYC or tax terms, or a conduct policy.

## Discrepancies and additions against the parent specification

No contradiction was found. The live rules add the following items that the specification does not state, and the README and checklist should absorb them:

1. Baseline rule for pre-1-November code and the `pre-hackathon` / `hackathon-submission` convention. History shows none needed; the README should say so.
2. The two-projects-per-person disclosure and the two-per-email limit.
3. The exact `size` strings, the `nearAddress` pattern, the 12,000-byte body limit, the `requestId` reuse rule, the `website` trap, and the status-code handling. The payload template follows them.
4. A hosted demo is optional under the rules ("a plus"), whereas the specification and issue #13 treat hosting through judging as a requirement. The local-only fallback (public repository, reproducible README, post with video) is explicitly permitted. This relaxation matters for the go/no-go decision in `launch-runbook.md`.
5. AI screening of reproducibility. README commands that need administrator rights (`playwright install --with-deps`), a pinned Node 26.13.0, a pinned Rust toolchain, or an S3 download are friction for an automated checker. This is for the later README pass; no change is made here.
6. The post must carry the phrase "built at NEAR HACKATHON" and the two exact tags; the specification only says "event identification, tags".

## Verification checklist (run again immediately before submitting)

- [ ] Open the live `HACKATHON.md` in a browser and confirm: the deadline is still 2026-11-14 23:59 UTC, the endpoint is still `POST https://nearhackathon.com/api/applications`, the eleven fields and their limits are unchanged, and the required tags and phrase are unchanged.
- [ ] Confirm the time with an independent clock: it is before 05:29 IST on 15 November 2026 (14 November 23:59 UTC), and the submission is sent no later than the proposed 04:30 IST hard stop.
- [ ] The repository head that is public right now (a read of the remote, not a local branch) is the commit you intend judges to see. At 22:20 IST on 14 November the remote `main` was `ab633b0`, behind the local integration branch.
- [ ] Repository is public in a signed-out browser window, shows the `LICENSE`, and its README opens at the intended commit.
- [ ] README discloses: AI assistance, dependencies, baseline (none), second project (none or named), real versus simulated labels, trust and operational limits.
- [ ] The X post is published by the human, is public in a signed-out window, contains the phrase and tags, and has the video attached and playable. Its URL is 300 characters or fewer.
- [ ] Hosted links (if any) respond from a clean browser profile and a phone.
- [ ] Every personal field in the payload came from the human in this session, not from this repository or an earlier draft.
- [ ] `nearAddress` is a mainnet account the human controls and matches the regular expression.
- [ ] `requestId` is a fresh UUID generated once, saved outside the repository, and reused on any retry.
- [ ] The body is under 12,000 bytes and contains exactly eleven fields.
- [ ] The human has read the contact notice and the promotional-rights term, and has said so before `consent` is set to `true`.
- [ ] A submission was not already made earlier. A second POST for the same repository returns 409.
- [ ] After a 201, record the date and time and tell the human. Do not retry. Use the request-changes page for any later correction.
