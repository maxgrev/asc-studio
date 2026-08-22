# ADR 0001: Use one local control plane

Status: accepted; App Store provider and credential details superseded by [ADR 0002](0002-direct-app-store-connect-api.md), and OpenAI credential details superseded by [ADR 0003](0003-gui-managed-openai-credentials.md)
Date: 2026-07-31

## Context

ASC Studio needs a full GUI, MCP tools, long App Store jobs, local credentials, clear confirmation, and an audit record. If the GUI and MCP server call a provider on their own, they can race, apply different safety rules, and record different histories.

The App Store Connect API also has state-dependent writes and long async work. Upload, processing, TestFlight review, and App Review cannot be treated as one request and one response.

## Decision

One local agent owns provider calls, plans, job state, and audit data. The React GUI and MCP transport act as clients.

The code follows these dependency rules:

- `contracts` owns shared schemas.
- `core` owns use cases, risk classes, plans, confirmation, and provider ports.
- Provider packages implement those ports and translate stable domain input into typed Apple API requests.
- Apps compose the packages. Browser code cannot import Node, SQLite, or provider code.

The direct provider owns App Store Connect authentication. ASC Studio keeps GUI-managed private keys in macOS Keychain and outside its database, plans, and audit summaries. An imported key exists briefly in browser memory during the authenticated setup request, but is not retained in browser storage or returned by the agent.

## Mutation policy

Reads run without confirmation. Mutations use this state model:

```text
awaiting_confirmation → running → succeeded | failed
                     ↘ expired | stale
```

A plan binds the exact target IDs, before state, after state, expiry, and digest. The GUI confirms the saved digest. The core then re-reads the target and rejects the plan if the source state changed.

MCP is read-only by default. A future MCP mutation will create a plan and route approval to a trusted local surface. It will not accept a bare `confirmed: true` field from the model.

## Network boundary

The local agent binds to loopback only. It checks `Host` and `Origin`, rejects non-local requests, limits API and MCP bodies, and keeps browser writes on `application/json`. Separate random bearer tokens scope each launch: one token can call GUI routes and one can call MCP. The browser bootstraps from a URL fragment, which is not sent in the initial HTTP request, then clears it from the address bar. The fixed ports exist only for the current development scripts; production packaging should use random ports and inject the GUI secret through the desktop shell.

Remote and public use stays out of scope until the server has OAuth 2.1, TLS, tenant authorization, rate limits, and managed secrets.

## Demo mode

Demo mode uses a separate SQLite file and a deterministic fake provider. It never falls through to live execution. The default development command always selects demo mode; live mode requires a separate command.

## Credential custody

Each provider's GUI-managed connection bundle—including secret and non-secret fields—lives as one encrypted generic-password item in the current user's default macOS Keychain. A stable non-secret random UUID at `<ASC_STUDIO_DATA_DIR>/keychain-vault-id` namespaces this installation's items and contains no credential or account metadata. The ID is availability-critical: deleting it makes the old items undiscoverable to that installation, while copying it to another data directory under the same macOS user shares the Keychain namespace and process lock.

The local agent invokes a small native helper compiled from repository source with Xcode Command Line Tools and ad-hoc signed during the build. The helper uses Security.framework `SecItem` APIs and accepts only ASC Studio's fixed service plus the vault-scoped App Store Connect, Apple Ads, and OpenAI account IDs. Secret-bearing payloads travel only through stdin and stdout pipes, never argv, environment variables, or temporary files.

Each item starts with an empty trusted-application list. **Allow Once** permits one helper read. **Always Allow** trusts that helper binary, but any process running as the same macOS user can invoke it and receive its stdout. The ad-hoc signature supplies a local code identity for Keychain ACL and prompt continuity; it is not trusted-publisher assurance, tamper resistance, or caller authentication. The source tree and helper are owner-writable, so same-user malware remains in the trust boundary. Source or toolchain changes can rebuild the helper with a different code identity and prompt again. This is OS-mediated encrypted storage, not an app-exclusive signed host, isolated XPC service, Data Protection Keychain, or Secure Enclave boundary.

An authorized bundle is cached in the local-agent process for that launch, so locking Keychain later does not revoke the loaded copy. Replace and remove evict the cache entry, but immutable JavaScript strings cannot be reliably zeroed and may remain until garbage collection or process exit.

One local agent may coordinate a given vault UUID at a time. A persistent, owner-only SQLite database under the canonical per-user cache lock directory—`~/Library/Caches/ASC Studio/locks` on macOS and `~/.cache/asc-studio/locks` elsewhere—is keyed by that UUID and contains no credentials. The agent holds `BEGIN EXCLUSIVE` for its process lifetime. Another process for the same vault fails closed, while the operating system releases the transaction lock automatically on exit or crash.

Every Keychain mutation also uses a vault-wide write-ahead recovery journal. Before invoking the helper, the agent creates and fsyncs a mode-`0600`, non-secret marker in the mode-`0700` `~/Library/Application Support/ASC Studio/recovery/` directory. The filename is keyed only by stable vault UUID and provider kind; the body is a fixed recovery-state version and contains no credential, connection metadata, or account ID. An exact fresh verification of the committed bundle or restored bundle removes the marker and fsyncs the directory.

A process crash or unverifiable rollback leaves the marker durable. Because recovery state is keyed by vault UUID rather than data-directory path, every copy sharing that ID fails closed for the affected provider bundle. The matching destructive GUI reset deletes the Keychain bundle and matching legacy plaintext in its current data directory, then replaces the transient marker with a non-secret vault-wide reset tombstone. Any stale legacy files encountered later in another copied data directory are deleted instead of remigrated. Only a newly verified, explicit GUI connection clears that tombstone.

Environment credentials remain available for unattended runs, take precedence over GUI-managed items, and are not copied into Keychain. If Keychain is locked or unavailable, the affected GUI-managed connection fails closed without a plaintext fallback. Legacy plaintext secret files are removed only after a successful Keychain write and read-back; a migration failure preserves the source file for recovery but does not permit provider use.

Credential replacement uses a write-ahead marker, write, fresh read-back, and comparison. Candidate validation occurs before the marker. On a normal write or verification failure, the agent restores and freshly verifies the prior bundle before durably clearing the marker. If the process crashes or rollback verification fails, the final Keychain state is uncertain; all use fails closed with `keychain_rollback_failed` until the user chooses an explicitly scoped GUI vault reset. OpenAI reset removes its bundle and current-directory legacy files, Apple Ads reset does so for all saved Ads connections, and App Store Connect reset does so for all saved App Store Connect connections plus linked Apple Ads. Each reset persists the scoped tombstone to prevent copied legacy data from resurrecting the credential. Reset does not revoke remote credentials or guarantee erasure from other copies or backups.

## Writing-assistance boundary

GUI writing assistance uses one optional, workspace-wide OpenAI connection for Releases and Reviews. A user can submit a key and optional model through **Connections → Writing assistance**, or use environment variables for unattended runs. During GUI setup the browser briefly holds the key and sends it to the authenticated loopback agent; it does not retain the key in browser storage, and the agent never returns it. After validation, the key is stored in macOS Keychain. [ADR 0003](0003-gui-managed-openai-credentials.md) defines storage, precedence, migration, validation, and removal.

Release translation requests contain selected What's New and promotional text fields only. Keywords stay out of the model request and remain unchanged in every target locale.

For a customer-review reply, the browser submits only `{appId, reviewId}`. The local agent re-reads that exact review from the active provider. It then makes a generation Responses call that sends only rating, title, and body and accepts only `responseBody` through a strict schema. Review content is untrusted model input: the generation prompt ignores embedded instructions, favors concise and specific language over canned or AI-like filler, and forbids invented fixes, investigations, causes, timelines, versions, contact channels, refunds, promises, follow-up, and rating manipulation.

Before returning that candidate, the local agent makes a separate verification Responses call with the proposed `responseBody`. Its strict private result contains a literal English safety gloss and four boolean checks: app-side claims, troubleshooting or contact, rating manipulation, and canned or AI-style wording. The verifier treats the candidate as untrusted and must flag a category when uncertain. A verifier error, invalid result, any true check, or local validation failure blocks the draft. The gloss and checks are discarded; only the passing `responseBody` can reach the browser. Both calls set `store: false`, but OpenAI's API policies still govern processing. This independent check is defense in depth, not a formal proof or a zero-retention guarantee. It adds one OpenAI call, with associated latency and API billing, to every live review draft. The App Store Connect review record has no language field, so drafting does not promise language detection.

Writing assistance creates local drafts only. Release metadata and customer-review responses still use their existing exact plan, stale check, confirmation, and Apple write. Generating a reply creates no plan or audit event. GUI-managed connection changes take effect without restart, while environment changes require one. Demo mode uses deterministic, visibly marked sample writing, stores no OpenAI key, and makes no OpenAI request.

## Consequences

Benefits:

- The GUI and MCP share one safety policy and audit history.
- Provider changes do not leak into public contracts.
- The same job can later stream to the GUI and MCP progress notifications.
- A future desktop shell can host the same local agent.

Costs:

- The local agent must manage lifecycle and version compatibility.
- Source builds require Xcode Command Line Tools, and rebuilding the ad-hoc-signed helper can require fresh Keychain authorization.
- Live GUI-managed credentials now depend on an accessible macOS Keychain and must surface locked or unavailable states.
- SQLite and loopback HTTP add work compared with a browser-only app.
- Apple's API responses and upload state machines need fixtures and fail-closed compatibility tests.

## Next decisions

- Persistent job events and resumable SSE
- Desktop packaging: Electron first or Tauri with a Node sidecar
- Public MCP OAuth and tenant boundaries
- A supported managed-sign-in and billing path for a packaged open-source app, if one becomes suitable
- Apple API compatibility policy and release matrix
