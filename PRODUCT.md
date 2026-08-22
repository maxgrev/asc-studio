# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

ASC Studio serves developers and app operators who manage Apple-platform releases, TestFlight distribution, App Store metadata, screenshots, review submissions, and Apple Ads. The primary operating context is a developer's own Mac, where they need a trustworthy view of live Apple state and a controlled way to make changes.

## Product Purpose

ASC Studio is a local-first control plane for App Store Connect and Apple Ads. It combines a desktop-grade web interface with an MCP server so people and coding agents can inspect Apple data, prepare work, and complete supported workflows without depending on another App Store CLI. Success means replacing fragmented App Store operations with complete, understandable, auditable workflows.

## Positioning

The product's distinguishing mechanism is one local policy layer shared by the GUI and MCP entry points. It connects directly to Apple's public APIs, keeps GUI-managed secrets in macOS Keychain and policy enforcement in the local agent, permits read-only automation, and routes every supported external write through an expiring plan, an exact review, an account binding, a stale-data check, a one-time confirmation, and an audit record.

## Operating Context

- Users run the local agent and browser interface on a Mac, connect one or more App Store Connect organizations, and choose an active app.
- App Store Connect and Apple Ads appear under one Apple organization in the studio while retaining separate roles and API credentials.
- OpenAI writing assistance is an optional workspace-wide connection shared by Releases and Reviews across every Apple account.
- Codex can use the local MCP endpoint for reads and for preparing supported Apple Ads plans; final confirmation remains in the local GUI.
- Deterministic demo mode exercises the same product paths without contacting Apple. Its visibly marked sample writer does not call OpenAI. Live mode reads and writes through Apple's public APIs.
- The product is intended to be open source and is licensed under GPL-3.0-only.

## Capabilities and Constraints

- Current complete workflows cover TestFlight builds and group assignment; release versions and frequent metadata; guarded App Review submission; assisted release-copy translation; screenshots; app-scoped written customer reviews, grounded reply drafting, and guarded public responses; multiple App Store Connect accounts; and Apple Ads research, reporting, and guarded campaign management.
- App Store Connect and Apple Ads credentials are separate. Imported private keys pass through the authenticated browser form once but are not retained there; generated Apple Ads private keys never enter the browser. No secret enters SQLite audit data or logs.
- OpenAI writing assistance uses one local-agent BYOK configuration for release translation and review replies. **Connections → Writing assistance** accepts a key and optional model once; the browser briefly holds and sends them to the authenticated loopback agent, never stores the key, and never receives it back.
- Each provider's GUI-managed bundle is encrypted in the current user's default macOS Keychain. The data directory keeps `keychain-vault-id`, a stable non-secret random UUID that contains no credential or account metadata but is availability-critical: deleting it loses the installation's association, while copying it under the same macOS user shares the namespace and process lock.
- A source-built, ad-hoc-signed native helper uses Security.framework `SecItem` APIs and accepts only ASC Studio's fixed service and vault-scoped provider account IDs. Secret-bearing payloads use stdin/stdout only, never argv, environment, or temporary files. Items start with an empty trusted-application list. **Allow Once** permits one read; **Always Allow** trusts the helper binary, which any same-user process can invoke. The ad-hoc signature provides local Keychain code identity, not trusted-publisher assurance, tamper resistance, or caller authentication; owner-writable source and binaries leave same-user malware in the trust boundary. Source or toolchain changes can rebuild the helper and prompt again. This is not an app-exclusive signed host, XPC service, Data Protection Keychain, or Secure Enclave boundary.
- An authorized bundle is cached in local-agent memory for that launch, so locking Keychain later does not revoke an already loaded copy. A locked, denied, or unavailable Keychain fails closed on any required read. Environment values remain external, take precedence, and are the supported unattended path.
- A persistent, owner-only, non-secret SQLite coordination database in the canonical per-user cache lock directory is keyed by vault UUID. One process holds `BEGIN EXCLUSIVE` for its lifetime, preventing concurrent Keychain bundle updates for the same vault; the operating system releases the transaction lock on exit or crash. The database contains no credentials.
- Before every Keychain mutation, a vault-wide write-ahead recovery journal creates and fsyncs an owner-only, non-secret marker under `~/Library/Application Support/ASC Studio/recovery/`, keyed only by vault UUID and provider kind. Exact verified commit or rollback durably removes it; crash or unverifiable rollback leaves it, blocking that provider bundle across all data-directory copies sharing the vault ID until scoped reset. The marker contains only a fixed recovery-state version. Reset replaces it with a non-secret vault-wide tombstone so stale legacy plaintext in another copied data directory is deleted rather than silently remigrated; an intentional verified reconnect clears the tombstone.
- Legacy plaintext credential files migrate only after a successful Keychain write and read-back. Failed migration leaves the legacy file intact for recovery but does not permit plaintext fallback. GUI save, replace, and remove actions affect subsequent requests without restart; environment changes require one.
- Before saving or replacing a GUI key, the agent makes a constant-input, `store: false` Responses request. This point-in-time validation uses a small OpenAI API call and remains subject to OpenAI's API data policies. The connection is global rather than tied to an Apple account; demo mode neither stores a key nor calls OpenAI.
- Normal Keychain replacement failures restore and freshly verify the previous item before durably clearing the recovery marker. If rollback cannot be verified or the process crashes with the marker present, the resulting state is explicitly uncertain, use fails closed, and the GUI offers a destructive reset scoped to OpenAI only, all Apple Ads, or all App Store Connect plus linked Apple Ads. Reset deletes the bundle and matching legacy plaintext in the current data directory, then records the vault-wide reset tombstone. Removal and reset do not promise forensic erasure of other copies or backups, remote revocation, or cancellation of an in-flight request.
- Review generation resolves the current review from its app and review IDs in the local agent. One `store: false` Responses call sends only rating, title, and body and returns only `responseBody`; a separate `store: false` verification call returns a private English gloss and checks for app-side claims, troubleshooting or contact, rating manipulation, and canned or AI-style wording. Verification errors, uncertainty, or flagged content fail closed, and the gloss and checks are discarded. This defense-in-depth step adds one OpenAI call, with associated latency and API billing, but is not a formal safety proof. A passing result remains a local, editable draft until the existing exact response-plan workflow is separately reviewed and confirmed.
- New Apple Ads campaigns, ad groups, and keywords start paused.
- The public Apple API is the product boundary. Unsupported work must be identified as web-only or deferred, never disguised behind private endpoints or browser automation.
- Initial app creation, some certificates and service keys, privacy-label answers, Resolution Center messages, and some commercial agreements do not currently have complete public API coverage.
- Direct IPA/PKG upload, a complete Store Listing editor, monetization, distribution, activity, additional submission controls, version-scoped review browsing, aggregate storefront ratings, and review-response deletion remain future work.
- ASC Studio is not affiliated with Apple.

## Brand Commitments

The product name is ASC Studio. Product copy is precise, calm, and operational: it distinguishes local drafts from Apple writes, demo data from live data, relative popularity from search counts, and supported API behavior from web-only gaps. It does not invent capabilities, performance claims, or market evidence.

## Evidence on Hand

- The repository contains automated provider, policy, route, and store tests plus deterministic demo data.
- Accepted concepts and verified implementation captures live in `docs/design/` for TestFlight, Releases, App Review submission, Apple Ads, and Apple-services connection flows.
- The README and roadmap describe shipped workflows and explicit limits.
- No testimonials, customer counts, adoption metrics, or independent benchmarks are established; future product surfaces must not fabricate them.

## Product Principles

1. Ship complete workflows, not thin collections of API wrappers.
2. Make every external mutation exact, reviewable, stale-safe, and auditable.
3. Keep GUI-managed secrets in macOS Keychain and policy enforcement local while allowing useful read-only agent access.
4. Tell the truth about Apple's data, service boundaries, and unsupported operations.
5. Keep demo and live modes behaviorally aligned so the product can be explored safely.
