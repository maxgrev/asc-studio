# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

ASC Studio serves developers and app operators who manage Apple-platform releases, TestFlight distribution, App Store metadata, screenshots, review submissions, and Apple Ads. The primary operating context is a developer's own Mac, where they need a trustworthy view of live Apple state and a controlled way to make changes.

## Product Purpose

ASC Studio is a local-first control plane for App Store Connect and Apple Ads. It combines a desktop-grade web interface with an MCP server so people and coding agents can inspect Apple data, prepare work, and complete supported workflows without depending on another App Store CLI. Success means replacing fragmented App Store operations with complete, understandable, auditable workflows.

## Positioning

The product's distinguishing mechanism is one local policy layer shared by the GUI and MCP entry points. It connects directly to Apple's public APIs, keeps credentials in the local agent, permits read-only automation, and routes every supported external write through an expiring plan, an exact review, an account binding, a stale-data check, a one-time confirmation, and an audit record.

## Operating Context

- Users run the local agent and browser interface on a Mac, connect one or more App Store Connect organizations, and choose an active app.
- App Store Connect and Apple Ads appear under one Apple organization in the studio while retaining separate roles and API credentials.
- Codex can use the local MCP endpoint for reads and for preparing supported Apple Ads plans; final confirmation remains in the local GUI.
- Deterministic demo mode exercises the same product paths without contacting Apple. Live mode reads and writes through Apple's public APIs.
- The product is intended to be open source and is licensed under GPL-3.0-only.

## Capabilities and Constraints

- Current complete workflows cover TestFlight builds and group assignment; release versions and frequent metadata; guarded App Review submission; assisted release-copy translation; screenshots; multiple App Store Connect accounts; and Apple Ads research, reporting, and guarded campaign management.
- App Store Connect and Apple Ads credentials are separate. Private keys never enter the browser, SQLite audit data, or logs.
- New Apple Ads campaigns, ad groups, and keywords start paused.
- The public Apple API is the product boundary. Unsupported work must be identified as web-only or deferred, never disguised behind private endpoints or browser automation.
- Initial app creation, some certificates and service keys, privacy-label answers, Resolution Center messages, and some commercial agreements do not currently have complete public API coverage.
- Direct IPA/PKG upload, a complete Store Listing editor, monetization, distribution, reviews, activity, and additional submission controls remain future work.
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
3. Keep credentials and policy enforcement local while allowing useful read-only agent access.
4. Tell the truth about Apple's data, service boundaries, and unsupported operations.
5. Keep demo and live modes behaviorally aligned so the product can be explored safely.
