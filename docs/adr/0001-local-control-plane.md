# ADR 0001: Use one local control plane

Status: accepted for the first release
Date: 2026-07-31

## Context

ASC Studio needs a full GUI, MCP tools, long App Store jobs, local credentials, clear confirmation, and an audit record. If the GUI and MCP server call `asc` on their own, they can race, apply different safety rules, and record different histories.

The App Store Connect API also has state-dependent writes and long async work. Upload, processing, TestFlight review, and App Review cannot be treated as one request and one response.

## Decision

One local agent owns provider calls, plans, job state, and audit data. The React GUI and MCP transport act as clients.

The code follows these dependency rules:

- `contracts` owns shared schemas.
- `core` owns use cases, risk classes, plans, confirmation, and provider ports.
- Provider packages implement those ports and translate stable domain input into allowlisted `asc` argument arrays.
- Apps compose the packages. Browser code cannot import Node, SQLite, or provider code.

`asc` owns App Store Connect credentials. ASC Studio stores only profile names, operation plans, safe summaries, and output digests. It does not copy API keys or `.p8` files into its database.

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

## Translation boundary

GUI translation uses an OpenAI API key from the local agent's `OPENAI_API_KEY` environment variable. Browser code receives only provider readiness and generated release-copy drafts; it never receives the key. The request contains selected What's New and promotional text fields only. Keywords stay out of the model request and remain unchanged in every target locale.

Translation creates local drafts. The existing App Store metadata plan still handles review, stale checks, confirmation, and the Apple write. Demo mode uses marked sample translations and makes no OpenAI request.

## Consequences

Benefits:

- The GUI and MCP share one safety policy and audit history.
- Provider changes do not leak into public contracts.
- The same job can later stream to the GUI and MCP progress notifications.
- A future desktop shell can host the same local agent.

Costs:

- The local agent must manage lifecycle and version compatibility.
- SQLite and loopback HTTP add work compared with a browser-only app.
- `asc` JSON output needs fixtures and fail-closed compatibility tests.

## Next decisions

- Persistent job events and resumable SSE
- Desktop packaging: Electron first or Tauri with a Node sidecar
- Public MCP OAuth and tenant boundaries
- A supported managed-sign-in and billing path for a packaged open-source app, if one becomes suitable
- Provider compatibility policy and release matrix
