# ADR 0002: Call the App Store Connect API directly

Status: accepted
Date: 2026-08-16

## Context

The first live provider called the external `asc` CLI. That let ASC Studio ship complete workflows quickly, but it made another product's binary version, command design, credential store, and JSON output part of our runtime contract. Pinning one CLI release also blocked fixes and caused response-shape failures.

ASC Studio's product is the App Store Connect control layer itself. A third-party command runner cannot remain its core execution engine.

## Decision

The local agent calls Apple's public App Store Connect REST API directly.

- The provider signs short-lived ES256 JSON Web Tokens from the user's issuer ID, key ID, and `.p8` private key.
- Live HTTP requests can send credentials only to the configured Apple API origin.
- Pagination links must keep the same origin.
- Automatic retries apply only to reads. Mutations rely on the existing plan, stale-state, and audit policy instead of blind retries.
- Asset uploads follow the signed upload operations returned by Apple. Those requests do not carry the Apple authorization token.
- Apple error codes and request IDs cross the provider boundary in a safe form.
- The public GUI and MCP API expose product actions, never a generic Apple request method.

The GUI can import and switch between team API keys. The local agent validates each key with Apple before saving it in an owner-only file under the local data folder. Account changes take an exclusive lock against in-flight Apple operations, and mutation plans bind to the account ID used during review. Environment credentials remain available for unattended runs and override GUI-managed accounts. Credentials never enter SQLite, audit summaries, browser storage, or logs.

## Consequences

ASC Studio no longer requires the `asc` binary or tracks its release and output shapes. We now own JWT signing, request types, pagination, rate-limit handling, uploads, polling, and Apple error mapping. Provider tests use Apple's JSON:API shapes and the official OpenAPI contract as their source.

Some App Store Connect web features still have no public API. They remain explicit web-only boundaries; this decision does not permit hidden private endpoints or browser automation.
