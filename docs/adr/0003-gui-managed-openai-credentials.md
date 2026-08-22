# ADR 0003: Store the OpenAI writing credential in macOS Keychain

Status: accepted
Date: 2026-08-21

## Context

Release translation and customer-review reply drafting use the OpenAI Responses API. Requiring `OPENAI_API_KEY` at process launch made writing assistance harder to discover and forced a restart for every key change. The connection also needs one consistent security boundary across Releases, Reviews, and multiple Apple accounts.

## Decision

ASC Studio exposes an optional OpenAI connection under **Connections → Writing assistance**. It is global to the local workspace rather than attached to an App Store Connect organization. Release translation and review reply drafting resolve the same current credential for every request.

The GUI accepts an API key and optional model. It sends them once to the authenticated loopback agent. The browser necessarily holds the submitted values briefly while the form is open and the request is in progress, but it does not put the API key in local storage or session storage. The local agent never returns the key in connection status, errors, or later reads. A same-origin script compromise could capture a key while it is entered or submitted, so the existing local-origin, bearer-token, and content-security boundaries remain material.

## Keychain storage

After validation succeeds, the local agent saves the GUI-managed API key and optional model ID together as one encrypted item in the current user's default macOS Keychain, normally the login Keychain. A stable non-secret random UUID at `<ASC_STUDIO_DATA_DIR>/keychain-vault-id` namespaces this installation's items so moving the data directory does not orphan them; it contains no credential or connection metadata. The API key does not enter SQLite, plans, audit records, application logs, connection-status responses, or later reads returned to the browser.

The persistent SQLite database used to coordinate one local-agent process per vault UUID contains no credential data. ADR 0001 defines its canonical cache location and process-lifetime `BEGIN EXCLUSIVE` transaction.

Before every OpenAI Keychain mutation, the vault-wide write-ahead recovery journal creates and fsyncs an owner-only, non-secret marker under `~/Library/Application Support/ASC Studio/recovery/`. Its filename uses only vault UUID and the OpenAI provider kind, and its body contains only a fixed recovery-state version. An exact verified commit or rollback removes it and fsyncs the directory. A crash or unverifiable rollback leaves it, so every data-directory copy sharing the vault ID fails closed for OpenAI until OpenAI-only reset deletes the bundle and current-directory legacy files, then records a non-secret vault-wide reset tombstone. Stale legacy files in copied directories cannot remigrate while it exists; a newly verified explicit OpenAI connection clears it.

The local agent uses a source-built, ad-hoc-signed native helper that calls Security.framework `SecItem` APIs. The helper accepts only ASC Studio's fixed Keychain service and vault-scoped provider account IDs. Secret-bearing payloads travel only through stdin and stdout pipes, never argv, environment variables, or temporary files.

The item is created with an empty trusted-application list. **Allow Once** permits one helper read. **Always Allow** trusts that helper binary, which any process running as the same macOS user can invoke. The ad-hoc signature provides local Keychain code identity, not trusted-publisher assurance, tamper resistance, or caller authentication; owner-writable source and binaries keep same-user malware inside the trust boundary. A source or toolchain change can rebuild the helper with a different identity and cause another authorization prompt. This is not an app-exclusive signed host or XPC service.

After an authorized read, the agent caches the bundle in process memory for that launch to avoid repeated prompts. Locking Keychain afterward does not revoke the loaded copy. Replacement and removal evict the cache entry, but immutable JavaScript strings cannot be reliably zeroed and may remain in runtime memory until garbage collection or process exit.

Keychain is an encrypted database with access mediated by macOS, but this implementation is not an app-bound hardware vault. A process the user authorizes, an administrator, or malware running in the logged-in account remains inside the trust boundary. This decision does not claim Data Protection Keychain, Secure Enclave protection, or guaranteed forensic erasure. [Apple's Keychain Services documentation](https://developer.apple.com/documentation/security/keychain-services) defines the platform boundary.

If Keychain is locked, unavailable, or returns an unexpected item, the connection reports a needs-attention state and writing assistance fails closed. The agent does not fall back to a plaintext secret.

## Migration from file storage

Older builds stored GUI-managed bundles in plaintext credential files. During upgrade, the agent writes the complete legacy bundle to Keychain and reads it back before removing all corresponding plaintext metadata and secret files. A failed write or read-back leaves the source files intact so migration can be retried, but the agent does not use them for OpenAI requests; there is no plaintext fallback.

## Environment precedence and lifecycle

`OPENAI_API_KEY` has precedence over a saved GUI key. Any defined environment value is authoritative, including an invalid value, so the agent never silently falls back to the saved credential. While an environment key is active, the GUI reports the connection as externally managed and blocks replacement or removal. Environment values are never copied into Keychain and inherit the security boundary of the launching process.

`ASC_STUDIO_OPENAI_MODEL` overrides a saved model or ASC Studio's default model for the running process. Without that override, a model saved through the GUI wins over the default.

Environment changes require a process restart. GUI save, replace, and removal are resolved dynamically and affect subsequent writing requests without restart. The OpenAI connection remains unchanged when an Apple account is switched or removed.

## Validation boundary

Before saving or replacing a GUI credential, the local agent holds the candidate in memory and makes a small, constant-input request to the fixed OpenAI Responses endpoint using the effective model. The request sets `store: false`, refuses redirects, requires strict structured output, and contains no App Store content. A candidate-validation failure happens before the recovery marker or any Keychain write and leaves the previous item unchanged.

After creating and fsyncing the marker, the agent performs the Keychain write followed by a fresh read-back and exact comparison. An exact commit clears the marker durably. On a normal write or verification failure, it restores and freshly verifies the previous item before clearing the marker and reporting the original failure. A crash or rollback-verification failure leaves the marker because the agent cannot claim which item is present: the connection reports `keychain_rollback_failed`, all writing assistance fails closed across copies sharing the vault ID, and the GUI offers a destructive reset of the OpenAI marker and bundle only.

This probe consumes a small OpenAI API call and can add latency and billing. It establishes only that the key and model worked at that moment. It does not prove future availability, authorization, quota, or model behavior. `store: false` is a request setting, not a zero-retention guarantee; OpenAI's API policies still govern processing and retention.

## Removal boundary

Removing or resetting a GUI-managed connection deletes its OpenAI Keychain item and matching legacy plaintext files in the current data directory, then leaves the scoped non-secret reset tombstone. This prevents subsequent writing requests and copied legacy files from restoring it until a new verified connection is explicitly saved. Keychain deletion is not a promise of forensic erasure from underlying storage, other copied directories, or existing backups. It does not revoke the credential at OpenAI, so a compromised key must also be revoked there. A request that resolved the key before removal may finish in flight.

Environment-managed credentials cannot be removed through the GUI. Removing the environment variables and restarting the process reveals any previously saved GUI connection again.

## Demo mode

Demo mode reports deterministic sample writing assistance. It neither stores an OpenAI credential nor calls OpenAI, including during connection setup.

## Consequences

Users can configure writing assistance without restarting the local agent, while unattended environments retain explicit precedence. The browser participates briefly in initial secret entry, and GUI-managed keys use macOS Keychain rather than a plaintext credential file. This improves at-rest protection while making source builds depend on Xcode Command Line Tools, the native helper, and Keychain availability. Connection validation adds one small external call; rollback can enter an explicit uncertain state; and deletion cannot promise revocation or forensic erasure.
