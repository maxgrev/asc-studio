# Security policy

ASC Studio controls App Store Connect resources and must be treated as privileged local software.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Until the project has a public security mailbox, contact the maintainer through a private channel listed on their GitHub profile and include:

- The affected version or commit
- The smallest reproduction
- The impact and required access
- Whether credentials or real App Store data may have been exposed

Do not include live API keys, private keys, access tokens, or user data in the report.

## Supported versions

Before the first stable release, only the current `main` branch receives security fixes.

## Security model

- The agent binds to loopback and accepts local origins only.
- Separate, random per-launch bearer tokens protect GUI and MCP routes. An MCP token cannot confirm a GUI plan.
- The GUI receives its token in a URL fragment, stores it for the browser session, and clears the fragment before making requests.
- The direct provider signs ten-minute Apple JWTs in the local agent. It never returns the `.p8` key or Apple bearer token to browser code.
- Each provider's GUI-managed connection bundle is stored as one encrypted generic-password item in the current user's default macOS Keychain, normally the login Keychain. `<ASC_STUDIO_DATA_DIR>/keychain-vault-id` is a mode-`0600` regular file inside an owner-controlled, non-symlink data directory that ASC Studio tightens to mode `0700` before creating the ID. The file contains only a stable, non-secret random UUID used to namespace this installation's Keychain items—never a credential or account metadata.
- The vault ID is not confidential, but it is availability-critical. Deleting it makes previously stored Keychain items undiscoverable to that installation. Copying it to another data directory under the same macOS user intentionally shares the Keychain namespace and process lock. SQLite, plans, audit records, application logs, and API responses do not contain secret values.
- Cross-process coordination uses a persistent, owner-only SQLite database keyed by the vault UUID under `~/Library/Caches/ASC Studio/locks` on macOS or `~/.cache/asc-studio/locks` elsewhere. It contains no credentials. The agent holds a `BEGIN EXCLUSIVE` transaction for its process lifetime; a second process for the same vault fails closed, and the operating system releases the transaction lock on normal exit or crash.
- Every Keychain mutation first creates and fsyncs a mode-`0600`, non-secret write-ahead recovery marker under the mode-`0700` `~/Library/Application Support/ASC Studio/recovery/` directory. Its filename is derived only from stable vault UUID and provider kind; its body contains only a fixed recovery-state version, never credentials, connection metadata, or account IDs.
- An exact fresh read-back of the committed bundle or an exact fresh verification of the restored bundle clears the marker and fsyncs the recovery directory. A crash or unverifiable rollback leaves the marker durable. The affected provider bundle then fails closed in every data-directory copy sharing that vault ID until an explicitly scoped reset deletes the Keychain bundle and current-directory legacy files, then replaces the marker with a non-secret vault-wide reset tombstone. Other copied directories cannot remigrate stale legacy files while that tombstone exists; a newly verified explicit GUI connection clears it.
- The local agent uses a small native helper compiled from repository source with Xcode Command Line Tools and ad-hoc signed during the build. The helper calls Security.framework `SecItem` APIs and rejects every service or account identifier outside ASC Studio's fixed service and three vault-scoped provider accounts.
- Secret-bearing helper payloads use a bounded, length-framed envelope over stdin and exact stored bytes over stdout. The helper rejects truncated or extra write data before any Keychain mutation. Secrets never enter helper command-line arguments, its environment, or temporary files; operations and validated non-secret account identifiers are the only arguments.
- Each item is created with an empty trusted-application list. **Allow Once** permits one helper read. **Always Allow** trusts that helper binary, but any process running as the same macOS user can invoke it and receive its stdout. The ad-hoc signature provides a local code identity for Keychain ACL and prompt continuity; it is not a trusted-publisher signature, tamper-resistant boundary, or caller-authentication mechanism. The source tree and helper are owner-writable, so same-user malware remains in the trust boundary. A source or toolchain change can rebuild the helper with a different code identity and cause macOS to request authorization again. This is encrypted, OS-mediated storage—not an app-exclusive signed host, isolated XPC service, Data Protection Keychain, or Secure Enclave vault.
- After an authorized read, the local agent caches the connection bundle in process memory for that launch to avoid repeated prompts. Locking Keychain afterward does not revoke an already loaded bundle. Replace and remove evict the relevant cache entry, but immutable JavaScript strings cannot be reliably zeroed and may remain in runtime memory until garbage collection or process exit. A process the user authorizes, an administrator, or malware in the logged-in account remains in the trust boundary.
- When the agent needs a Keychain read, a locked Keychain, denied access, unavailable or unsafe helper, or invalid item makes the affected connection fail closed with a sanitized unavailable response. ASC Studio does not fall back to a plaintext credential file. Restore Keychain access or rebuild the helper, then retry the connection.
- On upgrade, each complete legacy connection bundle is written to Keychain and read back exactly before its plaintext metadata and key files are removed. A failed migration leaves the legacy files intact for recovery but not provider use; there is no plaintext fallback. Migration can be retried after Keychain access is restored.
- Environment-managed credentials override their GUI-managed counterparts and are never copied into Keychain. Their exposure depends on the launching process, shell history, and any referenced key files. Environment variables are the supported path for unattended or headless operation. Environment changes require a process restart; GUI-managed changes affect subsequent requests immediately.
- Authorized API requests are origin-locked to App Store Connect. Apple's signed asset-upload URLs do not receive the Apple bearer token.
- Automatic provider retries apply to reads, not mutations.
- MCP exposes read-only tools in the first release.
- Mutations require an expiring plan, exact digest, and stale-state check.
- API and MCP bodies have the same 64 KiB limit.
- SQLite and audit records store safe summaries, not credentials.
- Demo data uses a separate database and cannot call the live provider.
- OpenAI writing assistance is optional and workspace-wide, not scoped to one Apple account. Releases and Reviews use the same connection.
- Imported App Store Connect and Apple Ads private keys, and a submitted OpenAI API key, briefly exist in browser memory while their setup form is open and the authenticated loopback request is in progress. They are never put in local or session storage and are never returned after submission. Generated Apple Ads private keys stay in the local agent. A same-origin script compromise could still capture an imported or typed secret during entry or submission.
- `OPENAI_API_KEY` overrides a saved Keychain item and blocks GUI mutation while active. `ASC_STUDIO_OPENAI_MODEL` overrides the saved or default model.
- Saving or replacing a GUI key first makes a constant-input Responses request with `store: false`. The request contains no App Store content, costs a small API call, and validates access only at that moment. OpenAI's API policies still govern processing and retention.
- A candidate-validation failure occurs before a recovery marker or Keychain mutation and leaves the current item unchanged. After a marked Keychain write or verification failure, ASC Studio normally restores and freshly verifies the previous item, then durably clears the marker. If rollback cannot be verified, it returns `keychain_rollback_failed`, treats the resulting state as uncertain, and fails closed until the user performs an explicit vault reset.
- Vault reset is destructive and scoped: OpenAI reset deletes the OpenAI bundle and matching current-directory legacy files; Apple Ads reset deletes the bundle and current-directory legacy files for every saved Apple Ads connection; App Store Connect reset does the same for all saved App Store Connect connections plus linked Apple Ads. Each scope retains a non-secret reset tombstone until a new verified GUI connection is deliberately saved. Removal and reset do not guarantee forensic erasure from other copied directories, Keychain storage, or backups, revoke credentials at Apple or OpenAI, or cancel requests already in flight.
- OpenAI credentials do not enter SQLite, audit records, application logs, or API responses. The agent sends them only as authorization for the fixed OpenAI Responses origin.
- Release copy goes to OpenAI only after the user presses Translate. Keywords are never included in that request. Review drafting sends only the authoritative review's rating, title, and body, followed by a separate verification request for the proposed reply.
- Demo writing assistance never stores an OpenAI key or makes an OpenAI request.

Local audit data is not tamper-proof against the owner of the machine. A future hosted service will need separate tenant authorization, OAuth, key management, encryption, and immutable security logs.
