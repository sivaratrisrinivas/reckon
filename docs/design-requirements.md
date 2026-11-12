# Reckon: UI and UX requirements

User-supplied constraints added during the design interview on 13 November 2026, IST. The user confirmed these constraints and the direction in `DESIGN.md` as the shared understanding. This document records approved requirements, not verified performance results.

## Core experience

- Reach the core objective in no more than three clicks. The objective, start state, and treatment of external wallet interactions must be made explicit before designing the flow; do not silently exempt those interactions.
- Only one primary action per screen, with full attention on it.
- Every customer touchpoint must have clear intent and evoke an appropriate emotion. Delete touchpoints without intent.
- Every visible element must serve the product. Nothing decorative without purpose.
- Make the experience intuitive and low effort, including for people who do not study instructions.
- Limit details and refine those that remain.
- Apply relevant Apple Human Interface Guidelines: clarity, deference, depth, consistency, feedback, and progressive disclosure.

## Required design process before application coding

1. Product understanding: what is shown or offered, intended audience, emotion in the first two seconds, and the core objective.
2. Design system: type direction, colors and their 3D material equivalents, spacing rhythm, and shadow language.
3. Scene and flow structure: emotional arc and the shortest path to the core objective within the agreed three-click definition.
4. 3D/three.js opportunity map: identify which moments merit 3D and which remain 2D. An opportunity map does not make 3D mandatory.
5. Performance budget: target 60 fps on a defined mid-range device profile, with high, medium, and low quality tiers. Define measurements before claiming success.

## Accepted direction

- The player objective is to take the opposing side, understand the stake, and see the outcome. Asking for a forecast starts the experience; viewing life and the record requires no click.
- The three-click limit applies to Reckon-controlled interactions. Count and report external wallet interactions separately. Do not claim first-time wallet creation and funding take three total clicks.
- Prepare wallet readiness before generating a forecast the visitor intends to challenge. Preserve wallet-free spectating and forecast requests.
- Use restrained futuristic tension. The emotional arc is curiosity, challenge, anticipation, consequence. Motion should explain thinking, commitment, settlement, or loss of life.
- A 3D representation of life is only a candidate if it communicates state better than 2D. It is not a mandatory technology choice.

## Approved design direction

`DESIGN.md` at the repository root develops all five required stages. The user approved its visual direction, readiness flow, performance budgets, and 2D-first recommendation as the pre-code design basis. Flow and performance claims remain targets to verify during implementation.

## Reference guidance inspected

Apple's [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) emphasizes purposeful, optional motion and concise feedback. Its [accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility) covers legibility, alternatives to color-only signals, keyboard access, familiar interactions, and avoiding unnecessarily time-limited controls. Apply these principles to the web experience without assuming native Apple controls or effects are mandatory.
