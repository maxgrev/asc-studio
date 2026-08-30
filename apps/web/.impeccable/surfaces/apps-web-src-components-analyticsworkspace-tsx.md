---
version: 1
slug: "apps-web-src-components-analyticsworkspace-tsx"
primary_target: "apps/web/src/components/AnalyticsWorkspace.tsx"
related_targets: ["apps/web/src/App.tsx","apps/web/src/components/Sidebar.tsx","apps/web/src/api.ts","apps/web/src/analyticsData.ts","apps/web/src/styles.css","apps/web/index.html","packages/contracts/src/index.ts","packages/core/src/analytics.ts","apps/local-agent/src/analytics-store.ts","apps/local-agent/src/analytics-sync.ts"]
---

# Analytics — Portfolio Pulse

## Approval

- Approved option: **Portfolio Pulse** (`portfolio-pulse`)
- Approved comp: `.impeccable/mocks/decision/analytics-portfolio-pulse.webp`
- User refinement: the default scope is **All accounts**, aggregating every app across every connected App Store Connect organization. The left roster begins with an `All accounts` row, groups apps by account source, and selecting an app narrows the same evidence canvas without changing the shell's active operational account.
- User refinement: **readiness is a separate, distilled state**. When the unfiltered portfolio has no real KPI values, hide the dashboard controls, roster, empty KPI rail, chart, tables, and stacked diagnostics. Show one recovery surface with plain-language account rows, one contextual action, and technical detail on demand.
- The reference comp is a north star, not literal data. Its `Conversion` and `Active devices` labels must be replaced until the underlying Apple reports support mathematically valid aggregates. MVP uses an explicitly defined `Download rate` and additive `Sessions`, with visible provenance and caveats.

## Direction contract

**THESIS:** Analytics is one all-account portfolio-to-app evidence surface: first see whether the whole business moved across every connected organization, then select the app that contributed to the movement, while date range, comparison, metric, provenance, and freshness remain fixed. It refuses Apple’s maze of disconnected report menus and the generic widget collage.

**OWN-WORLD:** Preserve ASC Studio’s existing calm operator shell: flat light/dark surfaces, hairline borders, blue selection, semantic status dots, compact controls, tabular values, no persistent shadows, gradients, glass, or decorative AI motifs.

**STORY:** The operator enters on `All accounts`, reads portfolio totals and a comparison trend, sees which account and app explain the change, selects one app without switching operational credentials, then drills into its territory/source/version evidence. Missing, privacy-suppressed, incomplete, unreachable-account, and zero values remain visibly distinct. A later AI explanation may act only on explicitly selected aggregate facts; it is not part of this first shipped slice.

**FIRST VIEWPORT:** With real data, the existing topbar leads into date/comparison/filter controls plus one `Update data` action. A 340–360px roster contains `All accounts` plus every app grouped by account source and stays visible beside the dominant evidence canvas. The canvas begins with one compact metric strip and one broad current-versus-previous chart. With no unfiltered portfolio values, the first viewport is instead one centered readiness panel: a short explanation, one row per Apple account, one contextual action, and collapsed technical details. These states never stack.

**FORM:** Portfolio Pulse, grounded candidate 6/7 from surface seed `14f440e0`, with the user-authored all-account aggregate state taking precedence over the comp’s initially selected-app state.

## Component grammar sampled from the approved comp

- Ground: compressed comp sample `#f9f9f9`; implementation maps to incumbent `--bg` (`#f7f8fa` light, `#0d0f13` dark).
- Main surfaces: compressed comp sample `#fefefe`; implementation maps to `--surface` (`#ffffff` light, `#171a20` dark).
- Selected row: compressed comp sample near `#edf5fd`; implementation uses incumbent `--accent-soft`.
- Primary blue: dominant saturated comp sample near `#1164ec`; implementation uses incumbent `--accent` (`#1464e8` light, `#79adff` dark).
- Borders: the comp’s compressed hairlines sample near `#e6eaeb`; implementation uses incumbent `--border` so Analytics does not fork the shell.
- Corners: 7–9px only. Line weight: 1px surfaces/gridlines, 2px chart series and focus outlines. Elevation: none in the workspace; overlays alone may use the incumbent dialog shadow.
- Type: existing Inter/system stack. Page title 32px incumbent; panel titles 17px; body and KPI labels 14px; data 15–22px with tabular numerals; axes/secondary metadata 12px minimum. No operational text below 12px.

## Visible inventory and implementation medium

| Ingredient | Composition commitment | Medium |
| --- | --- | --- |
| Existing ASC Studio shell | Analytics sits directly below Overview; shell app selector remains available | Existing React/CSS/Lucide |
| Global scope controls | Date range, previous-period comparison, metric, filters, and one `Update data` action; context persists during drill-down | Semantic HTML controls |
| Readiness recovery | Replaces the entire evidence dashboard when the unfiltered portfolio has no values; plain per-account status, one `Review setup`/`Update data`/`Try again` action, technical details collapsed | Semantic section, rows, button, and details disclosure |
| Account/app roster | First row is `All accounts`; account-source groups contain compact app rows with selected metric and delta; 340–360px desktop | Semantic buttons/list and grouped mobile select |
| Metric strip | Seven additive/derived metrics—Impressions, First-time downloads, Total downloads, Product page views, Download rate, Sessions, and Estimated proceeds—with per-metric source and complete-through text; one continuous bordered rail, not floating cards | Semantic HTML/CSS |
| Dominant comparison chart | Straight-line current and dashed comparison series, real gaps for unavailable data, release/event annotations only when sourced | Accessible responsive SVG plus an HTML data table |
| Portfolio state lower table | Ranked apps with current, comparison, delta, and contribution to portfolio change | Semantic table/buttons |
| App state lower table | Ranked territory/source/version drivers compatible with the selected metric | Semantic table/buttons |
| Freshness and privacy strip | Per-source completeness, usage opt-in caveat, suppressed-is-not-zero copy | Semantic HTML/status text |
| Historical snapshot | Advanced collapsed action inside freshness; never competes with ongoing setup in the first viewport | Semantic details disclosure and reviewed mutation plan |
| AI explanation | Deferred follow-on: explicit selection-scoped secondary action with cited aggregate facts only, never chat or automatic generation | Not shipped in this slice |
| Images | No image-native content belongs in the shipped Analytics workspace | Empty asset manifest; decision comp is reference only |

## Production asset manifest

`{"surface":"Analytics — Portfolio Pulse","assetRoot":"apps/web/public/assets/analytics/","assets":[],"directoryCreated":false}`

The chart, gaps, roster marks, contribution bars, freshness strip, and tables remain authored SVG/HTML/CSS. `AppSummary` exposes no icon URL, so raster app marks would fabricate app identity. The approved 1665×944 WEBP is a compositional reference only.

## Responsive and interaction contract

- Above 1220px: persistent roster beside the evidence canvas.
- 821–1220px: compact 280px roster; table remains readable and chart remains dominant.
- 621–820px: roster becomes a horizontal/compact scope chooser above the evidence; metric strip becomes 2 columns.
- At 620px and below: add a reachable global workspace selector because the incumbent sidebar is hidden; one-column flow, 2-column metric strip, 260px minimum chart, filter dialog with focus trap, and labeled breakdown rows.
- Selecting `All accounts` or an opaque catalog app ID updates the URL-backed view and preserves date, comparison, metric, and exact facet filters. Back/forward restores the scope without activating an App Store Connect account. Filters are server-applied and distinguish an empty filtered result from an unsynced range.
- `Sync all accounts` and cache-only `Refresh view` are not separate user concepts. The usable dashboard exposes one `Update data` action. Cache refreshes never produce a success banner; partial data produces at most one compact coverage summary.
- Report-request creation remains plan-first and confirm-first. In recovery, `Review setup` starts with one safely inspectable app at a time. A key's Apple role and an app's Analytics Reports request are explained as separate checks only inside the technical disclosure.
- Primary/comparison series differ by both line style and label. Keyboard Left/Right/Home/End navigates chart points; an HTML table exposes the same data.
- Updating retains the prior snapshot, shows `aria-busy`, and reports failure without blanking usable evidence.

## Truth and reliability boundaries

- Every response distinguishes `sample` from `live`, and every metric exposes source, formula/aggregation, coverage, and complete-through date.
- The server owns `ALL_CONNECTED` membership. The browser never constructs the global portfolio from the active account's app list and never activates accounts to merge responses.
- Named account-source failures preserve usable cached evidence but make the portfolio explicitly partial; missing accounts and report requests are never counted as zero.
- Portfolio totals include only additive metrics or ratios recomputed from additive portfolio numerators/denominators. Never average app-level rates.
- `Unique Counts`, `Unique Devices`, and `Paying Users` are not summed across Apple report rows. Missing and privacy-suppressed values render as em dash/gaps, never zero.
- Estimated proceeds remain labeled as Analytics estimates and never as finalized payouts.
- Apple Ads disconnection may remove paid-acquisition context but must not make App Store Analytics unavailable.
- If AI explanation is added later, it receives only selected canonical aggregate facts, cites exact evidence IDs, performs no new math, and cannot create a plan or write to Apple.
