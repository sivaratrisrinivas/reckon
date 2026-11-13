# Keep evidence public with an on-chain fingerprint

Reckon keeps each prediction's financial terms and outcome on-chain alongside a fingerprint of its evidence. The evidence snapshot, model identity, structured forecast, and short justification are published separately as downloadable data to keep the permanent contract record small. This trades self-contained on-chain evidence availability for lower storage costs; durable public hosting remains necessary, and the fingerprint detects edits rather than proving inference execution or recovering unavailable content.

Accepted by the user during the grill-with-docs interview on 13 November 2026, IST.

## Retention and operating budget

In the follow-up hosting interview, the user agreed that published evidence snapshots have no automatic expiry, including after judging and after Reckon's death. If hosting is deliberately retired, preserve a downloadable archive of the published snapshots.

Use the free Hobby plan for the current implementation. The user allows up to $5 per month if a future paid option materially simplifies reliable storage. That allowance does not require custom billing controls now; a billing alert alone is not a hard spending cap.

## Public storage and discovery

The user selected Vercel Blob on Hobby for public evidence, independently of the eventual application host. Do not enable automatic expiry. The free plan's quota exhaustion may pause evidence access for up to thirty days; this availability limitation is accepted and must be disclosed. Confirm the chosen project actually uses Hobby during setup.

Upload the canonical snapshot before publishing a prediction. Store its public HTTPS URL alongside its SHA-256 fingerprint in the immutable on-chain prediction record, so visitors can locate the snapshot without the application. The URL locates the bytes; the fingerprint detects changes. Neither establishes source truth, inference execution, or guaranteed availability.

## Independent archives

Applying the user's requirement to remove unnecessary scope, replace the proposed daily archive automation with a manual export. Issue #4 requires durable public downloads and edit detection, not a scheduled backup system. This reduces setup and maintenance while retaining an export path; it provides no daily recovery guarantee.

Provide one command to export the exact original snapshot bytes with a manifest of prediction IDs, public URLs, and fingerprints. Keep a downloaded copy and publish a public GitHub Release archive as part of the launch checklist before judging and before retiring storage. Scheduled releases, service-held GitHub publishing credentials, and an archive retry system are outside issue #4. GitHub Actions artifacts are not the durable archive.
