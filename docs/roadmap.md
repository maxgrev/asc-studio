# Roadmap

ASC Studio should grow by complete, auditable workflows. A long list of thin API wrappers would be easy to ship and hard to trust.

## 0.1 — TestFlight control room — complete

- Detect connection state and provider mode
- List apps, builds, processing state, expiry, and groups
- Search and filter builds
- Plan, review, and add a build to a tester group
- Store a local audit record
- Expose read-only MCP tools
- Keep demo and live data separate

## 0.2 — Release workspace — complete

- Select an app without restarting the local agent
- Create a new editable App Store version
- Carry stable metadata forward while leaving What's New empty
- Pull version localizations
- Edit promotional text, keywords, and What's New
- Show locale-aware diffs and field limits
- Reject expired plans, profile changes, and stale Apple data
- Run structured submission-readiness checks
- Add read-only version and localization MCP tools
- Keep demo and live writes on the same reviewed mutation path

## 0.3 — Guarded App Review submission — complete

- Select a ready, unexpired build that matches the version and platform
- Preview build attachment and review submission before creating a local plan
- Include validation counts, current build attachment, and exact target IDs in the review
- Re-read the connection, version, build, validation report, and preview before confirmation
- Attach the chosen build and submit through one confirmed workflow
- Read submission status in the GUI, API, and read-only MCP server
- Serve the built GUI and live agent through one loopback-only local command

## 0.4 — Assisted release copy — complete

- Use a local-agent BYOK path instead of implying that ChatGPT subscription billing covers API calls
- Translate What’s New from one source locale into selected locale drafts
- Translate promotional text only when the user includes it
- Keep keywords out of translation requests and preserve every locale's current keywords
- Validate model output against strict field, locale, and App Store length limits
- Keep demo translation local and deterministic

## 0.5 — Release screenshots — complete

- Read screenshot sets for one version localization and device type at a time
- Support iOS, macOS, tvOS, and visionOS screenshot device sets
- Check file type, dimensions, transparency, size, order, and the ten-file limit before planning
- Add screenshots, remove selected screenshots, or replace a full set
- Show exact uploads and removals, then re-read Apple state before confirmation
- Expose screenshot sets through the read-only MCP server

## 0.6 — Direct Apple API provider — complete

- Remove the external `asc` CLI runtime and version pin
- Sign short-lived Apple JWTs in the local agent
- Connect and validate an API key inside the GUI
- Save, switch, and remove multiple Apple accounts
- Store imported credentials outside SQLite with owner-only permissions
- Port apps, versions, localizations, builds, groups, screenshots, and review submissions
- Follow Apple's signed screenshot upload operations and processed-state checks
- Keep demo and live providers behind the same core ports

## Apple Ads intelligence and campaign management — complete

- Keep Apple Ads OAuth credentials separate from App Store Connect keys
- Group both service connections under the active Apple organization in the GUI
- Generate Apple Ads P-256 keys in the local agent and finish setup without a CLI
- Query Apple Ads Platform API v1 keyword suggestions and search-term popularity
- Rank candidates with Apple-provided signals without inventing search counts or difficulty
- Read campaigns, ad groups, keywords, and campaign performance through the local API and MCP
- Add a campaign and keyword-research GUI with account metrics and exact object inspection
- Create paused-first campaigns, manual-CPT ad groups, and keywords through typed review plans
- Update campaign budgets, countries, end dates, status, and keyword bids or status with stale checks
- Let MCP prepare Apple Ads plans while keeping confirmation and external writes in the local GUI

## Next — Submission train

- Direct IPA/PKG upload through Apple's Build Uploads resources, with a local picker and progress
- Add a glossary and a separate locale-specific keyword research workflow
- Add description and support/marketing URL editing
- App Review details and attachments
- App preview videos with upload progress and processed-state checks
- Cancel and release controls
- Long-running jobs with persisted events, cancellation, and recovery
- Webhook intake plus polling reconciliation

## 0.7 — Monetization

- IAPs, subscriptions, groups, offers, prices, territory availability, and review assets
- Version-aware IAP and subscription metadata
- Purchasing-power-parity plans with exact territory diffs
- StoreKit configuration export and test checks

## 0.8 — Distribution

- Bundle IDs, capabilities, certificates, profiles, and devices
- Profile regeneration after capability changes
- CSR and private-key custody rules
- A local Mac worker for archive, sign, export, upload, and dSYM jobs

## 0.9 — Store growth

- In-App Events
- Custom product pages and experiments
- Promoted purchases and offers
- Customer reviews and responses
- Product-page asset reuse and experiment workflows

## 1.0 — Open operator platform

- Packaged desktop app
- Revisit managed sign-in if a supported product and billing path fits a standalone open-source app
- Public MCP service with OAuth 2.1 and tenant authorization
- Durable queues and remote Mac workers
- Stable provider and tool contracts
- Signed releases, SBOMs, and a compatibility matrix

## Explicit web-only boundaries

The public Apple API does not cover every App Store task. The product must label these gaps instead of pretending a private endpoint is stable:

- Initial app record creation
- Developer ID certificate creation
- APNs service-key creation and one-time key download
- Privacy Nutrition Label answers
- Resolution Center and App Review message threads
- Some Account Holder agreements, tax, and banking work

Web-only adapters, if added, will live behind a separate capability and review policy. They will never masquerade as public API support.
