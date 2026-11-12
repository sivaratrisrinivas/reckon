# Reckon design

Approved pre-code design direction, confirmed by the user on 13 November 2026, IST. The detailed design below is the agreed basis for specification and implementation. No application code or visual prototype has been built, and the performance budgets have not been measured. References to proposed tokens, paths, and targets describe items still requiring implementation validation rather than outstanding user approval.

## 1. Product understanding

Reckon shows a model making an inspectable NEAR-price prediction and putting its own test-money bankroll behind it. A visitor can challenge it and receive a payment if it is wrong. Upkeep and losses consume its remaining life; death is permanent.

Primary audience: hackathon visitors and judges, including people unfamiliar with NEAR. The experience must explain the consequence before asking them to understand a blockchain.

The first two seconds should communicate: **this AI has something to lose**. Use the agent's remaining life, a short explanation, and one next action. The emotional direction is restrained futuristic tension: quiet surfaces and precise information surrounding an agent whose life is finite.

Core objective: take the opposing side with understood stakes and see the outcome. Asking for a forecast is the opening action, not a substitute success metric for placing a challenge. Viewing current life, the latest result, and the beginning of its record requires no click.

The emotional arc is curiosity, challenge, anticipation, consequence. Never manufacture urgency through fake activity or deadlines. The thirty-second challenge window is an actual market rule, and the interface must identify it as such.

## 2. Design system

### Typography

Use a humanist sans-serif direction for explanations and controls, with clear letterforms and moderate weight. Give life, prices, stakes, and time stable tabular numerals. Use a restrained monospaced treatment for numbers and identifiers rather than making the whole product look like a terminal. Select exact, licensed font files during asset preparation; self-host a minimal subset and avoid layout shifts.

Use a 16 px body baseline, 14 px supporting text, 12 px nonessential metadata, a 28 to 40 px prediction heading, and 48 to 72 px life readout depending on space. Essential financial terms never use the metadata size. Support 200% text enlargement and natural wrapping. Typography must remain legible without a downloaded font.

### Color and material direction

Proposed tokens, pending contrast checks in their actual combinations:

| Role | Color | Material equivalent and intent |
| --- | --- | --- |
| Background | #101315 | Matte graphite; visual quiet |
| Raised surface | #1B2023 | Satin charcoal; one interactive plane |
| Primary text | #F2F0E9 | Warm chalk; readable human language |
| Supporting text | #B7BDBE | Brushed pewter; secondary explanation |
| Dividers | #343C40 | Recessed seam; grouping rather than ornament |
| Primary action | #D8EF9B | Pale phosphor with dark text; next action |
| Focus | #A8D8F0 | Cool blue; keyboard location |
| Attention | #EBC27E | Amber indicator; preparation or pending state |
| Loss or death | #EDA09B | Muted red; consequence with a text label |

The primary action color has one role at a time. Do not reuse a vivid button treatment for secondary links, charts, or ambient glow. Color supplements words and shape; it never carries outcome or status alone.

Depth comes from a small difference between surfaces, a fine border, and one soft shadow on an overlay. Keep the main scene flat enough that the prediction and its financial terms remain dominant. No glass layer behind essential text, neon haze, decorative grids, star fields, floating tokens, custom cursor, or parallax.

### Spacing and controls

Use a 4 px spacing unit with a preferred 8, 12, 16, 24, 32, 48 sequence. Main reading width is about 640 px; the complete scene may reach 960 px on desktop. Use 20 px page gutters on small screens and more when space permits. Keep the primary action and essential terms visible together at the common mobile baseline, without preventing reflow for larger text or small viewports.

Primary controls have a minimum 48 px height and a full-width mobile treatment. Use the same moderate corner radius across controls, avoiding nested card decoration. Distinguish keyboard focus from hover and pending state. No essential control depends on hover, dragging, or a precise gesture.

### Motion and feedback

Brief state transitions explain what changed without delaying interaction. Target 120 to 180 ms for control feedback, 180 to 240 ms for panel changes, and a single short outcome transition. Reserve layout space so changing prices, timers, and status messages do not move the action under the pointer.

The life readout updates honestly. Do not animate a speculative win, payment, or death before confirmed state supports it. Receipt of a transaction hash means submitted, not paid. Pending, confirmed, failed, and retryable-payment states must be visibly distinct.

Respect reduced motion. Keep numerical life, deadlines, and textual outcome intact with movement removed. Never require an animation to finish before reading or acting. No autoplay audio, confetti, indefinite decorative pulse, or continuous camera movement.

## 3. Scene and flow structure

### One scene, one changing primary action

Use a single main route whose central scene updates with state. On first paint show the name, testnet status, remaining life, and the sentence: **An AI that pays when it is wrong.** The current prediction or latest result occupies the main reading area. Begin the public record below the scene rather than hiding all history behind navigation.

Trust details, downloadable evidence, and the full settlement rule use clearly labelled secondary disclosures. The stake, potential total return, challenge deadline, network, and risk of losing the stake remain visible before approval. Do not use progressive disclosure to hide consent-critical terms.

| State | Visible purpose and emotion | Primary action |
| --- | --- | --- |
| Idle | Life and last outcome invite curiosity | Ask Reckon |
| Wallet preparation | Explain the specific readiness requirement calmly | Connect or obtain test funds, only the currently needed action |
| Thinking | Actual inference status and cancelable waiting context | No new primary action |
| Abstained | Explain that the model declined to stake | Request again only when cooldown permits |
| Challenge open | Exact question, confidence, stake, return, closing time | Challenge for X test NEAR |
| Signature pending | Preserve the quote while the wallet requests consent | No duplicate submission action |
| Challenge submitted | Verify transaction outcome; do not imply the slot is secured yet | No duplicate submission action |
| Challenge accepted | Stake secured, outcome deadline visible | No action required |
| Challenge taken or closed | Clearly switch a late arrival to spectator status | No action required |
| Settling | Show that the oracle observation is pending | No action required |
| Settled | Outcome, actual payment status, change in life | Ask Reckon when available |
| Voided | Explain missing valid data and refund status | Ask Reckon when available |
| Operationally unavailable | Name the actual unavailable dependency | Retry only when useful |
| Dead | Date, permanent state, final record | No new-forecast action |

One primary action means at most one, not an obligation to invent a button during automatic progress. A deadline expiring must update the scene in place rather than dismissing information or moving focus unexpectedly. Keep record and evidence access available during waiting and after death.

### Click count and wallet readiness

Count every click on a Reckon control, including funding links, retry buttons, and disclosures, when evaluating that particular journey. Report wallet selection, connection, account creation, funding, and signature interactions separately. Do not present an external multi-step process as one total user interaction.

Proposed successful paths:

| Starting state | Reckon-controlled actions to stake | External work |
| --- | --- | --- |
| Connected, funded, idle | 1 Ask Reckon; 2 Challenge for X | Transaction approval |
| Disconnected, existing funded wallet, idle | 1 Ask Reckon starts wallet connection; 2 Challenge for X after automatic readiness and forecast | Wallet selection and connection; transaction approval |
| Wallet needs test funds | 1 Ask Reckon; 2 funding link if needed; 3 Challenge for X after readiness | Wallet setup or connection, faucet steps, transaction approval |
| Already open, ready wallet | 1 Challenge for X | Transaction approval; acceptance remains subject to slot and deadline |

For the main challenge path, Ask Reckon explicitly tells the visitor that wallet preparation comes first and no stake moves until they approve it. Connection opens directly from that action; avoid adding an intermediate application-level Connect button. Check readiness again after returning from the wallet or faucet. With a still-active forecast request and explicit advance notice, proceed automatically from verified readiness to inference rather than asking for another Continue click. Do not unexpectedly create a new request after a stale reload or canceled flow.

Only publication starts the thirty-second challenge window. Wallet preparation for the visitor's own requested forecast happens before inference and publication. Inference time itself does not consume the published challenge window.

Keep a quiet secondary **Just watch** path in readiness. It permits requesting a forecast without a wallet and moves directly into inference. Viewing an existing prediction or record is always wallet-free. This is not a second equally prominent primary action.

A request does not reserve the challenger slot. State that the first valid accepted challenge takes it. A late arrival may miss a round; never extend or reset an on-chain deadline to make the local UI appear successful.

The three-click acceptance criterion applies to successful available-forecast paths. An abstention, an already-taken slot, insufficient operational funds, or failed external wallet action cannot be converted into a guaranteed stake. Record those journeys separately, explain their actual outcome, and include any subsequent retry clicks honestly. Tests must not preconnect or prefund a wallet while labelling a journey as a first visit.

### The outcome is part of the objective

Do not require a fourth click to reveal the result. Keep the accepted prediction visible through settlement; allow the visitor to leave and return to it without wallet reconnection just to read it. After a win, show total paid and transaction confirmation. If payment failed, say payment is pending and expose the necessary recovery action rather than announcing success. A recovery action serves the existing obligation and is not a new bet.

## 4. 3D and three.js opportunity map

| Moment | Potential spatial treatment | Decision for the first build |
| --- | --- | --- |
| Agent present | One small life object could make a finite agent feel tangible | Start with a precise 2D life glyph and numeric readout; evaluate one optional 3D treatment |
| Inference | One brief state change can distinguish thinking from idle | Prefer a restrained 2D state change; no perpetual rotating object |
| Stake accepted | Visually distinguish committed funds from spendable funds | Use labelled 2D values; no coins flying into a vault |
| Result changes life | A spatial change might make gain or loss tangible | Candidate for a single state-driven transition if it is clearer than 2D |
| Death | Stillness can communicate finality | A static depleted state with explicit text; no cinematic delay |
| Terms, controls, evidence, history | Precision and accessibility are essential | Always semantic 2D HTML |

Recommendation: do not make three.js a prerequisite for the playable build. A WebGL life object earns inclusion only if a comparison against the 2D version improves comprehension or recognition of the agent's state, fits the budget, and preserves accessible parity. Its material should follow the graphite and pale-phosphor system, not introduce a second visual language. Keep any qualitative state metaphor distinct from the exact numerical life estimate.

## 5. Performance budget and verification

These are proposed engineering acceptance targets, not measured results. Define a reference mid-range Android device and an integrated-graphics laptop before profiling; record model, browser, viewport, and network conditions with results. Desktop CPU throttling is supplemental evidence, not a substitute for a real mobile test.

### Budgets

- Target 60 fps during active transitions on the reference mid-range profile, corresponding to about 16.7 ms per frame. Measure frame-time distribution and missed frames; an average alone is insufficient.
- Target local interaction feedback within 100 ms. Wallet approval, inference, RPC confirmation, and settlement latency are separate stages with truthful pending feedback, not fabricated fast completions.
- Initial core application JS target: at most 200 KB compressed, excluding separately measured lazy wallet and optional 3D chunks. Core CSS target: 30 KB compressed. Initial font transfer target: 100 KB compressed or less.
- Show a usable 2D scene without downloading optional 3D or waiting for wallet initialization. Give the total transferred bytes for each tested journey as well as the initial-shell figure.
- No continuously rendered WebGL scene while visually unchanged. Suspend optional rendering when hidden or offscreen. A visible countdown can update its text once per second without announcing every tick to assistive technology.
- Give content layout stability a target CLS of 0.1 or less. Reserve space for the life readout, forecast, and transaction status.
- If optional 3D is attempted, start with one canvas, at most four draw calls, at most 20,000 visible triangles, no real-time shadows or postprocessing, and a device-pixel-ratio cap of 1.5. These are starting caps to validate, not proof of 60 fps.

### Quality tiers

| Tier | Rendering | Same essential experience |
| --- | --- | --- |
| High | Optional measured 3D life object and short state transitions | All text, controls, outcome, and life remain in HTML |
| Medium, default until profiling | 2D or simplified measured spatial treatment; reduced effects | Identical flow and information |
| Low or reduced motion | Static 2D life glyph; immediate state changes or minimal fades | Identical actions, terms, evidence, and outcome |

Choose conservative automatic quality and degrade on poor measured performance or WebGL failure without asking the visitor to tune graphics before playing. Respect reduced motion independently of hardware capability. A high tier can remain unavailable if no 3D candidate earns inclusion; do not build a graphics-settings screen solely to expose empty tiers.

### Approved review before application coding

The user confirmed the state layout and click-count table, visual direction, and 2D-first spatial recommendation as capturing the shared understanding. A subsequent visual prototype should test mobile hierarchy and readiness states before implementation polish, without being represented as production behavior.

### Verification after implementation

Run browser journeys for ready, disconnected, and unfunded wallets; an existing open prediction; wallet cancellation; model abstention; slot contention; deadline expiry; unavailable data; pending and failed payouts; reload; operational unavailability; and death. Record app clicks, external actions, and elapsed times separately.

Check keyboard-only operation, visible focus, contrast, 200% text size, screen-reader status messages, reduced motion, and 2D fallback. Profile active transitions on the reference hardware and report actual transferred bytes. Delete any effect that obscures terms, adds a step, delays interaction, or fails to communicate useful state.
