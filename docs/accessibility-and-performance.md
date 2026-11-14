# Accessibility, responsive layout and performance verification

This document defines how issue #10 is verified and where the evidence lives. Every performance figure here is an **emulated measurement** on a development machine. No real phone was available, and nothing below is a real-device result.

## Reference profiles

Both profiles use Playwright's Chromium headless shell. The browser version, host operating system, CPU and Node version are recorded in each evidence file.

| Profile | Emulation | Purpose |
| --- | --- | --- |
| Emulated mid-range mobile | 390 x 844 CSS px, device scale factor 3, touch input, mobile viewport, `Emulation.setCPUThrottlingRate` 4x | Stand-in for a mid-range Android phone. Throttling slows JavaScript, style and layout work. |
| Emulated integrated-graphics laptop | 1440 x 900 CSS px, device scale factor 1, no throttling | Stand-in for a laptop with integrated graphics. |

Network is loopback to the local service, which serves assets uncompressed. Inference, oracle and chain latency come from scripted fixtures and the local sandbox.

## Targets and how each is measured

| Target | Measurement |
| --- | --- |
| 60 fps during active transitions | A `requestAnimationFrame` probe records frame intervals only while a window is active: request to approval, approval to accepted, waiting to result, and a scroll through the whole page. A frame is missed when its interval exceeds 25 ms (at least one display refresh skipped). The target is met when at most 5% of active frames are missed and the 95th percentile interval is at most 18.5 ms. The full distribution (mean, p50, p95, p99, max, missed and skipped refreshes) is recorded. |
| Local control feedback within 100 ms | For each pressed control, the time from the click event to the frame after the first DOM change on that control. The state suite also asserts this under 4x CPU throttling with every RPC delayed by 600 ms, so a slow network cannot hide missing feedback. |
| Layout shift at most 0.1 | `layout-shift` entries over the whole journey, counting shifts that follow user input. The state suite asserts the same limit in every state it audits. |
| Core JS at most 200 KB compressed | The served `/app.js`, compressed with gzip level 9 and brotli quality 11. |
| Core CSS at most 30 KB compressed | The served `/style.css`, same compressors. |
| Initial fonts at most 100 KB compressed | No web font files ship; the page uses the system UI font stack. The state suite fails if an `@font-face` or font file appears. |
| Lazy wallet and optional graphics bytes | Reported separately. The wallet signing code is part of the core bundle and there is no optional 3D asset, so both lazy figures are 0 bytes. The share of the minified bundle that is wallet cryptography is reported. |
| Whole-journey transfer | Sum of `Network.loadingFinished.encodedDataLength` for every request during the measured journey, by resource type. |

Run the measurement with `npm run measure:experience`. It starts its own service, runs both profiles, writes `docs/evidence/accessibility-performance.json`, then fails if a target is missed. The state and accessibility suite runs with `npm run test:experience` and is part of `npm test`.

## Accessibility and responsive verification

Each state is produced through the real service, sandbox contract and the existing `RECKON_TEST` fixtures. The audit runs at 320, 390 and 1440 px, and at 200% text size at 390 and 1440 px.

| Requirement | Verified by |
| --- | --- |
| States: loading, idle, preparation, thinking, abstention, cooldown, operationally unavailable, challenge open, awaiting approval, submitted, accepted, closed, settling, resolved, void, payment pending, dead | `tests/experience/states.spec.ts`, one visible state label per state |
| At most one primary action per state, none while progress is automatic | `visiblePrimaryActions` in every audited state. Busy and inert controls use `aria-disabled` and lose the primary treatment. While a payment is owed, Retry payment or Verify payment receipt is the one primary action and Ask Reckon becomes secondary. |
| Consent-critical terms visible without a click | The challenge panel keeps side, confidence, stake, potential return, deadline, network and loss risk in view with the one action on a single 390 x 844 screen, asserted by position. The approval dialog repeats them and the settlement rule. |
| Keyboard-only operation | Every audited state is walked with the Tab key: each visible control must be reachable (busy controls stay reachable), each focused control must show a focus indicator, and nothing behind the modal dialog may take focus. Enter activation, the approval dialog, Escape cancellation and payment recovery are driven with the keyboard. |
| Visible focus and preservation | Focus ring width and contrast against both surfaces. The approval dialog focuses its title so a held Enter key cannot approve a stake. A busy control stays focused. When the challenge window closes the focused control keeps focus and changes in place, with zero focus events. |
| 200% text | The page scales with the root font size. The audit fails on horizontal scrolling, controls outside the viewport, overlapping controls, clipped text and targets below 44 px (24 px for links). |
| Contrast | Computed from styles for every visible text node, including opacity and layered backgrounds, plus focus ring and control border contrast. |
| Non-colour outcome cues | Every state has a text label and a shape mark; dead, void and closed also change border style. |
| Screen-reader status without spam | Repeated renders that do not change text write nothing. A seven-second observation of every live region in the idle and waiting states records no announcement. Aria snapshots cover the challenge panel and dialog. |
| Reduced motion | With `prefers-reduced-motion`, no transition or animation exists or runs. The default experience keeps only 120 to 240 ms control and panel feedback and nothing infinite. |
| Identical information and actions across rendering behaviour | Baseline, WebGL unavailable, reduced motion, forced colours, 6x CPU throttle and a phone viewport yield identical headings, terms, actions and accessibility tree. No canvas or WebGL context is ever requested and nothing beyond the document, script and stylesheet is fetched. |

## Rendering tiers

DESIGN.md allows a high tier to stay unavailable when no 3D candidate earns inclusion. None was built, so there is one conservative 2D rendering. Medium is that default. Low, reduced-motion and WebGL-failure conditions render the same DOM and actions, as the parity test shows. No graphics-setup screen exists, and none is needed.

## Limitations and what was not verified

- No screen reader (VoiceOver, TalkBack, NVDA, JAWS) was run. Live-region behaviour is verified through DOM observation and accessibility-tree snapshots, which cannot confirm what a screen reader speaks.
- Text enlargement is emulated by scaling the root font size to 200%. Browser page zoom and operating-system text scaling were not exercised.
- No real mid-range phone or integrated-graphics laptop was measured. Software compositing in a headless shell does not predict GPU rasterization cost.
- Contrast is computed for the dark theme the page ships; there is no light theme.
- Automated checks cover the failures they can detect and do not replace review with disabled users.
