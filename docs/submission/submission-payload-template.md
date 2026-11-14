# Submission payload template

Status: **template only. Nothing has been submitted and no personal value is filled in.** Fill the real payload in a private file outside this repository (it contains personal data, and the event page says not to commit it). Every `<HUMAN TO SUPPLY>` must come from the human in the current session. Do not copy values from earlier drafts, from git history, from the repository, or from memory.

Field rules are from the live event file as re-read on 14 November 2026 (`event-requirements.md`). Re-read the live file before submitting; it governs if anything differs.

## Template (not valid until every placeholder is replaced)

```json
{
  "requestId": "<GENERATE ONCE AT SUBMISSION TIME: a UUID, saved privately, reused on any retry>",
  "projectName": "Reckon",
  "leadName": "<HUMAN TO SUPPLY>",
  "email": "<HUMAN TO SUPPLY>",
  "size": "<HUMAN TO SUPPLY: exactly one of \"1\", \"2 - 4\", \"4 - 6\", \"6 - 8\", \"8+\">",
  "tracks": ["<HUMAN TO SUPPLY: one or more track ids>"],
  "nearAddress": "<HUMAN TO SUPPLY: a MAINNET account the human controls>",
  "projectUrl": "https://github.com/sivaratrisrinivas/reckon",
  "demoUrl": "<HUMAN TO SUPPLY: the public URL of the human's published X post>",
  "idea": "<see the draft text below; the human edits and confirms>",
  "consent": "<HUMAN TO SUPPLY: true, only after the human has read and agreed to the contact notice>"
}
```

Notes on the two prefilled values:

- `projectName` is a proposed default taken from the repository name. The human confirms or changes it (2 to 80 characters).
- `projectUrl` was read from the repository's own metadata (`gh repo view`). The human confirms it is the repository to be judged, that it is public in a signed-out window, and that it has not been submitted before (a second submission of the same repository returns 409).

## Fields, constraints, and who decides

| Field | Constraint | Decision |
| --- | --- | --- |
| `requestId` | UUID, generated once, reused on retries after network error or 503 | generated at submission |
| `projectName` | 2 to 80 characters | human confirms |
| `leadName` | 2 to 80 characters | human |
| `email` | valid, at most 160 characters, at most two submissions per email | human |
| `size` | exactly `1`, `2 - 4`, `4 - 6`, `6 - 8`, or `8+` | human |
| `tracks` | one or more of `defi`, `thesis`, `privacy`, `business`, `swarms`, `security`, `agents`, `realworld`, `games`, `nfts`, `memecoins`, `social`, `open`, no repeats | human (see track notes in `event-requirements.md`; this draft chooses nothing) |
| `nearAddress` | 2 to 64 characters, lowercase, `^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$`, the mainnet payout account the team created | human. It must exist on mainnet. It is not the testnet agent account and not a `*.testnet` name. |
| `projectUrl` | http(s), at most 300 characters, unique per repository | human confirms |
| `demoUrl` | http(s), at most 300 characters; the public URL of the X post | human, after posting |
| `idea` | 20 to 2000 characters: the problem, the product, and how NEAR fits in | human confirms |
| `consent` | boolean, must be `true`, only after the human agrees to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." | human |

Send exactly these eleven fields. Do not send a `website` field (it is a spam trap). The body must not exceed 12,000 bytes.

## Draft `idea` text (1,200 characters as written, including the bracketed sentence; the limit is 2,000)

Edit freely. The last bracketed sentence must be replaced with a statement of exactly what is real on the day. Remove claims the evidence does not support (for example the hosted-testnet or locked-account statements are not made here on purpose).

```text
Problem: confident AI predictions are easy to make and hard to hold accountable, and crypto interfaces keep small accountability experiments out of reach. Reckon makes an AI pay for being wrong. A visitor asks Reckon for one forecast on a fixed binary question: will the NEAR/USD settlement price be strictly above a reference price five minutes from now? A model picks yes, no, or abstains, with a confidence. Code fixes fair odds and caps Reckon's stake at 2% of its spendable bankroll. One challenger can take the opposite side within 30 seconds. After the deadline a price oracle observation settles the round, the correct party is paid, and an unavailable observation voids it with a refund. Configured upkeep steadily retires the bankroll until Reckon permanently dies; late winnings and transfers cannot revive it. How NEAR fits: a Rust NEAR contract holds the bankroll and the challenger's stake, enforces the immutable terms, calls the on-chain price oracle, pays out through tracked transfers, and keeps the public record, with a SHA-256 fingerprint of each downloadable evidence snapshot on chain. [HUMAN: state exactly what is real: testnet or local sandbox; simulated or live providers.]
```

Every sentence above was checked against the code at commit `e8e5ae4` (five-minute deadline, 30-second challenge window, 2% cap, fair-odds quote, oracle settlement and void refund, upkeep and permanent death, evidence hash on chain). Re-check after issues #10 to #12 merge, in particular any parameter #12 changes.

## Offline pre-check (the human runs it on the private file)

This script checks only the documented limits. It does not contact the event service, does not confirm anything with the human, and does not submit. Save it outside the repository (it is shown here rather than added to the repository so that the project's lint does not cover it), then run `node validate-payload.mjs /path/to/private/payload.json`. It was tested with an obviously fake valid file and an obviously invalid file; both behaved as expected.

```js
// Offline check of a private submission payload file. Never commit the payload.
import {readFileSync} from 'node:fs';

const raw = readFileSync(process.argv[2], 'utf8');
const payload = JSON.parse(raw);
const errors = [];
const fields = ['requestId', 'projectName', 'leadName', 'email', 'size', 'tracks', 'nearAddress', 'projectUrl', 'demoUrl', 'idea', 'consent'];
const sizes = ['1', '2 - 4', '4 - 6', '6 - 8', '8+'];
const tracks = ['defi', 'thesis', 'privacy', 'business', 'swarms', 'security', 'agents', 'realworld', 'games', 'nfts', 'memecoins', 'social', 'open'];
const nearPattern = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (name, min, max) => {
  const value = payload[name];
  if (typeof value !== 'string' || value.length < min || value.length > max) errors.push(`${name}: string of ${min}-${max} characters required`);
};
const httpUrl = name => {
  try {
    const url = new URL(payload[name]);
    if (!['http:', 'https:'].includes(url.protocol) || payload[name].length > 300) errors.push(`${name}: http(s) URL of at most 300 characters required`);
  } catch { errors.push(`${name}: not a valid URL`); }
};

const keys = Object.keys(payload).sort();
if (keys.join() !== [...fields].sort().join()) errors.push(`exactly these fields and no others: ${fields.join(', ')} (found: ${keys.join(', ')})`);
if (!uuid.test(String(payload.requestId))) errors.push('requestId: UUID required');
text('projectName', 2, 80);
text('leadName', 2, 80);
text('email', 3, 160);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email))) errors.push('email: not a valid address');
if (!sizes.includes(payload.size)) errors.push(`size: one of ${sizes.map(s => JSON.stringify(s)).join(', ')}`);
if (!Array.isArray(payload.tracks) || payload.tracks.length === 0 || new Set(payload.tracks).size !== payload.tracks.length || !payload.tracks.every(t => tracks.includes(t))) errors.push('tracks: one or more distinct ids from the official list');
text('nearAddress', 2, 64);
if (!nearPattern.test(String(payload.nearAddress)) || String(payload.nearAddress) !== String(payload.nearAddress).toLowerCase()) errors.push('nearAddress: lowercase NEAR account pattern required');
if (String(payload.nearAddress).endsWith('.testnet')) errors.push('nearAddress: looks like a TESTNET account; the payout account must exist on MAINNET');
httpUrl('projectUrl');
httpUrl('demoUrl');
text('idea', 20, 2000);
if (payload.consent !== true) errors.push('consent: must be true, and only after the human agrees to the contact notice');
if (Buffer.byteLength(raw) > 12000) errors.push('body exceeds 12000 bytes');
if (raw.includes('HUMAN TO SUPPLY') || raw.includes('GENERATE ONCE')) errors.push('placeholders remain');

if (errors.length) { console.error(errors.map(e => `- ${e}`).join('\n')); process.exit(1); }
console.log('Payload passes the offline checks. This does not confirm it with the human or with the event service.');
```

## Submission procedure (the human decides each step)

1. Re-read the live `HACKATHON.md`. Confirm the time is before the 05:29 IST (14 November 23:59 UTC) deadline.
2. The human supplies each personal value. Write them into the private payload file.
3. Run the offline pre-check.
4. Show the human the complete JSON and obtain explicit confirmation of exactly that text. Without that confirmation, do not send.
5. Send one `POST https://nearhackathon.com/api/applications` with `Content-Type: application/json`, or submit the same values through the form at `https://nearhackathon.com/#apply`. Never both.
6. Record the status code and time. On 201, tell the human. On 400, fix the listed fields and resend with the same `requestId`. On 503, wait a minute and resend with the same `requestId`. On 403, 409, or 413, stop and ask the human; never change the repository link or email to get around a 409.
7. Corrections to a saved submission go through `https://nearhackathon.com/request-changes` only.
