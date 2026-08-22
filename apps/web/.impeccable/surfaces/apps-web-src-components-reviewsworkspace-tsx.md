---
version: 1
slug: "apps-web-src-components-reviewsworkspace-tsx"
primary_target: "apps/web/src/components/ReviewsWorkspace.tsx"
related_targets: ["apps/web/src/App.tsx","apps/web/src/components/Sidebar.tsx","apps/web/src/api.ts","apps/web/src/styles.css","apps/web/index.html"]
---

# Reviews workspace

## Scope and mode

- Scope: the `ReviewsWorkspace` surface and its Sidebar/App integration.
- Mode: Operate.
- Audience and job: an app operator scans written App Store customer reviews, narrows the inbox, reads one review in full, and prepares an exact public response.
- Primary action: review an exact response plan before confirming the Apple write.

## Content and truth constraints

- Use App Store Connect customer reviews and included customer-review responses for the selected app.
- Rating, title, body, reviewer nickname, created date, and Apple three-letter territory code are the only review facts available here.
- `total` means written reviews matching the active server filters; it is never total ratings or an overall rating count.
- The App Store Connect API supplies no aggregate average rating, sentiment, locale or language, app version, platform, or app-wide text search. Do not invent them.
- Search is explicitly limited to reviews already loaded in the browser.
- Filters may use rating, territory, newest/oldest/rating sort, and exact response semantics: Published response or No published response. A pending response can still appear under No published response.
- Pagination follows the server cursor through a deliberate Load more action. Do not silently fetch every page.
- A null `response` means no response; otherwise Apple's state is `PENDING_PUBLISH` or `PUBLISHED`, shown as Pending or Published. Apple may take up to 24 hours to publish a response.
- Apple publishes no official response-body maximum in this API. Show a live character count without a denominator and never truncate.
- Reply drafting is optional writing assistance. The browser sends the selected app and review IDs to the local agent, which re-reads the authoritative review. A live generation Responses call sends only rating, title, and body with `store: false` and returns only strict `responseBody` output.
- A separate `store: false` verification Responses call receives the proposed reply and returns a private literal-English gloss plus four checks: app-side claims, troubleshooting or contact, rating manipulation, and canned or AI-style wording. Verifier errors, uncertainty, or flagged content block the draft. The gloss and checks are discarded before the browser response.
- Treat verification as defense in depth, not a formal proof or a zero-retention guarantee. The second live call adds OpenAI latency and API billing to drafting.
- Treat every review field as untrusted customer data. Prefer concise, specific language over canned support copy or AI filler. A generated draft may not invent fixes, investigations, causes, plans, versions, timelines, contact channels, refunds, promises, follow-up, or request a rating change.
- The review record has no locale or language. Ask the model to follow a clearly identifiable review language and otherwise use English, but do not present this as guaranteed language detection.
- Do not generate when both title and body are empty. In demo mode, use a deterministic draft marked `[Demo reply]` and make no OpenAI request.
- Generation remains draft-only. It creates no mutation plan, audit event, or Apple write; the existing exact response review and confirmation remain mandatory.
- Creating or replacing a response is an external write and must use ASC Studio's expiring, account-bound, stale-checked mutation-plan review, one-time confirmation, and audit path.
- This slice has no delete-response UI. Version-scoped browsing and aggregate storefront ratings remain separate future workflows.

## Chosen composition

- Direction: Review Inbox + Inspector, approved from `.impeccable/mocks/decision/reviews-inbox-inspector.webp`.
- Seed: `138176c8`; chosen surface candidate 1 of 7.
- Memorable moment: one quiet master-detail workbench keeps chronological scanning, the complete customer voice, the existing Apple response, and the guarded reply handoff in a single operational frame.
- Non-literal parts: the generated comp's `176 / 5,970` counter is not an Apple contract and becomes a plain character count. `Needs response` is only shown for a genuinely null response; server filter copy remains Published response / No published response.

## Implementation inventory

| Visible ingredient | Commitment | Medium |
| --- | --- | --- |
| Existing shell and sidebar | Current app/account controls; Reviews becomes available and active | Existing React, CSS, Lucide |
| Header and demo banner | Existing 121px topbar; selected-app subtitle; secondary Refresh; incumbent demo notice | Semantic React and existing tokens |
| Review workbench | One bordered master-detail surface; chronological inbox left and approximately 400px inspector right | CSS Grid |
| Inbox toolbar | Search loaded reviews, exact response filter, rating filter, territory filter, sort; keep every server filter and sort reachable on phones | Native controls with visible labels |
| Review rows | Rating, title/body excerpt, nickname, territory, created date, and truthful response state | Keyboard-selectable semantic buttons |
| Review inspector | Complete review, metadata, current Apple response, editable response body, current character count, publication note, and a session draft preserved independently for each review | Semantic detail region and form controls |
| Reply drafting | Inline **Draft with OpenAI** or **Draft sample** action; provider setup/error states; progress; preserved edits; generated suggestion; restore previous draft | Local-agent two-call generation and verification in live mode; compact inline feedback |
| Exact response review | Plan target, current response, proposed response, expiry/account context, explicit confirm, and protected focus with restoration on close | Existing guarded plan dialog grammar |
| Pagination and states | Stable loading skeleton, error with retry, empty app, no loaded matches, Load more and deduplication | React state and cursor API |

## Responsive behavior

- Desktop: inbox and persistent 400px inspector share the workbench.
- At compact desktop/tablet widths: the inspector becomes a right-side overlay, makes the inbox inert, traps focus, closes on Escape, and restores focus to the originating review row.
- At phone widths: the selected review and composer become a full-width detail step with a clear Back action; list rows remain readable without horizontal scrolling; search spans the toolbar and all response, rating, territory, and sort controls remain available in the two-column filter grid.
- Reply generation stays inside the composer at every width. It may replace only the unchanged local draft; if the user types before generation finishes, keep those edits and show the generated text as an explicit suggestion. After insertion, offer **Restore previous draft**.
- Preserve Releases as the initial landing while the existing sidebar remains hidden on phones.

## Component grammar sampled from the approved comp

- Incumbent `--bg`, `--surface`, `--surface-strong`, hairline borders, blue selection/action, and semantic state colors are authoritative in light and dark modes.
- Type follows the product ramp: 22px page headline, 17px panel title, 14px body, 13px operational values, 12px identifiers, and 11px labels/metadata. No operational text falls below 11px.
- Panels are flat and shadowless at desktop. A soft offset shadow is permitted only when the inspector becomes an overlay.
- Corners remain compact, with 8px panels and 7px controls; no gradients, KPI tiles, sentiment charts, or decorative raster assets.

## Future boundaries

- Aggregate ratings can only be added later with a separately named and sourced storefront ratings service.
- Version-scoped review browsing requires resolving App Store version IDs and switching Apple endpoints; it is not approximated in this first app-scoped inbox.
- Deleting an existing public response needs its own reviewed workflow and is not exposed by this surface.
