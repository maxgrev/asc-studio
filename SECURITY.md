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
- `asc` owns App Store Connect credentials.
- Provider commands use argument arrays with `shell: false`.
- MCP exposes read-only tools in the first release.
- Mutations require an expiring plan, exact digest, and stale-state check.
- API and MCP bodies have the same 64 KiB limit.
- Audit records store safe summaries, not credentials.
- Demo data uses a separate database and cannot call the live provider.
- `OPENAI_API_KEY` stays in the local agent process and never reaches browser code, SQLite, or logs.
- Release copy goes to OpenAI only after the user presses Translate. Keywords are never included in that request.
- Demo translation never makes an OpenAI request.

Local audit data is not tamper-proof against the owner of the machine. A future hosted service will need separate tenant authorization, OAuth, key management, encryption, and immutable security logs.
