# Contributing

ASC Studio is early. Small changes with a clear test are more useful than broad rewrites.

## Set up

```bash
npm install
npm run typecheck
npm test
npm run build
```

Use `npm run dev` for isolated demo data. Do not use a live App Store Connect profile while developing a feature unless the test needs it and you have checked every generated command.

The local agent does not hot-reload because each launch owns fresh GUI and MCP tokens. Restart `npm run dev` after changing agent or provider code. Vite still reloads browser code.

## Design rules

- Add one provider capability for one user goal.
- Keep `asc` flags and response shapes inside the provider package.
- Never add a generic command runner to the public API or MCP server.
- Resolve names to stable IDs before a mutation.
- Treat unknown operations as destructive.
- Keep MCP read-only unless a reviewed design adds trusted approval.
- Add a golden fixture for each supported `asc` JSON shape.
- Keep secrets, raw tokens, `.p8` files, passwords, and full private output out of logs and fixtures.

Architecture, security, public contract, and provider changes need an ADR or a short RFC in the pull request.

## Commit sign-off

This project uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a contributor license agreement. Sign each commit:

```bash
git commit -s -m "Describe the change"
```

The sign-off states that you have the right to submit the work under this repository's license.
