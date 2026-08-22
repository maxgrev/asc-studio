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

The GUI can import and switch between team API keys. An imported key exists briefly in browser memory for the authenticated setup request, is never placed in browser storage, and is never returned after submission. The local agent validates each key with Apple before saving the complete connection bundle as one encrypted item in the current user's default macOS Keychain. A stable non-secret random UUID at `<ASC_STUDIO_DATA_DIR>/keychain-vault-id` namespaces this installation's items so moving the data directory does not orphan them; it contains no credential or account metadata. Account changes take an in-process operation lock against in-flight Apple operations, and mutation plans bind to the account ID used during review. ADR 0001 defines the separate SQLite transaction lock that excludes another local-agent process for the same vault UUID.

Environment credentials remain available for unattended runs, override GUI-managed accounts, and are not copied into Keychain. A locked or unavailable Keychain fails closed. On upgrade from the legacy file store, the local agent removes a plaintext private-key file only after successfully writing and reading back the corresponding Keychain item; failed migration keeps the file for recovery but does not use it as a fallback. Credentials never enter SQLite, audit summaries, or logs.

## Consequences

ASC Studio no longer requires the `asc` binary or tracks its release and output shapes. We now own JWT signing, request types, pagination, rate-limit handling, uploads, polling, and Apple error mapping. Provider tests use Apple's JSON:API shapes and the official OpenAPI contract as their source.

Some App Store Connect web features still have no public API. They remain explicit web-only boundaries; this decision does not permit hidden private endpoints or browser automation.

The source-built, ad-hoc-signed native helper uses Security.framework `SecItem` APIs and accepts only ASC Studio's fixed service and vault-scoped provider account IDs. Secret-bearing payloads use stdin/stdout pipes only, never argv, environment, or temporary files. Items begin with an empty trusted-application list. **Allow Once** permits one read; **Always Allow** trusts the helper binary, which any same-user process can invoke. The ad-hoc signature is only local Keychain code identity, not trusted-publisher assurance, tamper resistance, or caller authentication; the owner-writable source and helper keep same-user malware inside the trust boundary. Source or toolchain changes may rebuild the helper with a different identity and prompt again.

An authorized bundle is cached in the local-agent process for that launch, so locking Keychain later does not revoke the loaded copy. Replacement and removal evict the cache entry, but immutable JavaScript strings cannot be reliably zeroed. Before every Keychain mutation, the vault-wide journal defined in ADR 0001 durably marks the provider bundle uncertain. Normal commit or rollback verification clears that marker; a crash or rollback-verification failure leaves all data-directory copies sharing the vault ID in a fail-closed state until the scoped GUI reset deletes the bundle and current-directory legacy files. Reset then records a vault-wide tombstone so stale legacy data in another copied directory cannot remigrate until an explicit verified reconnect. Reset and removal do not revoke keys at Apple or guarantee forensic erasure from other copies or backups. This design does not claim app-exclusive signed-host or XPC isolation, Data Protection Keychain access, or Secure Enclave protection.
