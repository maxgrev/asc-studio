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
- User refinement: the default scope is **Portfolio overview**, aggregating every app in the active App Store Connect organization. The left roster begins with an `All apps` row; selecting an app narrows the same evidence canvas without losing portfolio context.
- The reference comp is a north star, not literal data. Its `Conversion` and `Active devices` labels must be replaced until the underlying Apple reports support mathematically valid aggregates. MVP uses an explicitly defined `Download rate` and additive `Sessions`, with visible provenance and caveats.

## Direction contract

**THESIS:** Analytics is one portfolio-to-app evidence surface: first see whether the whole business moved, then select the app that contributed to the movement, while date range, comparison, metric, provenance, and freshness remain fixed. It refuses Apple’s maze of disconnected report menus and the generic widget collage.

**OWN-WORLD:** Preserve ASC Studio’s existing calm operator shell: flat light/dark surfaces, hairline borders, blue selection, semantic status dots, compact controls, tabular values, no persistent shadows, gradients, glass, or decorative AI motifs.

**STORY:** The operator enters on `All apps`, reads portfolio totals and a comparison trend, sees which apps explain the change, selects one app, then drills into its territory/source/version evidence. Missing, privacy-suppressed, incomplete, and zero values remain visibly distinct. A later AI explanation may act only on explicitly selected aggregate facts; it is not part of this first shipped slice.

**FIRST VIEWPORT:** Existing 121px topbar and demo/error banner lead into global date/comparison/filter controls. A 340–360px roster contains `All apps` plus every app and stays visible beside the dominant evidence canvas. The canvas begins with one compact metric strip, one broad current-versus-previous chart, then a ranked app or dimension table; freshness and coverage anchor the lower edge.

**FORM:** Portfolio Pulse, grounded candidate 6/7 from surface seed `14f440e0`, with the user-authored all-app aggregate state taking precedence over the comp’s initially selected-app state.

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
| Global scope controls | Date range, previous-period comparison, metric, filters, refresh/sync; context persists during drill-down | Semantic HTML controls |
| Portfolio/app roster | First row is `All apps`; compact app rows show selected metric, delta, and restrained sparkline; 340–360px desktop | Semantic buttons/list + authored SVG sparklines |
| Metric strip | Seven additive/derived metrics—Impressions, First-time downloads, Total downloads, Product page views, Download rate, Sessions, and Estimated proceeds—with per-metric source and complete-through text; one continuous bordered rail, not floating cards | Semantic HTML/CSS |
| Dominant comparison chart | Straight-line current and dashed comparison series, real gaps for unavailable data, release/event annotations only when sourced | Accessible responsive SVG plus an HTML data table |
| Portfolio state lower table | Ranked apps with current, comparison, delta, and contribution to portfolio change | Semantic table/buttons |
| App state lower table | Ranked territory/source/version drivers compatible with the selected metric | Semantic table/buttons |
| Freshness and privacy strip | Per-source completeness, usage opt-in caveat, suppressed-is-not-zero copy | Semantic HTML/status text |
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
- Selecting `All apps` or an app updates the URL-backed view and preserves date, comparison, metric, and exact facet filters. Back/forward restores the scope. Filters are server-applied and distinguish an empty filtered result from an unsynced range.
- Primary/comparison series differ by both line style and label. Keyboard Left/Right/Home/End navigates chart points; an HTML table exposes the same data.
- Refresh retains the prior snapshot, shows `aria-busy`, and reports failure without blanking usable evidence.

## Truth and reliability boundaries

- Every response distinguishes `sample` from `live`, and every metric exposes source, formula/aggregation, coverage, and complete-through date.
- Portfolio totals include only additive metrics or ratios recomputed from additive portfolio numerators/denominators. Never average app-level rates.
- `Unique Counts`, `Unique Devices`, and `Paying Users` are not summed across Apple report rows. Missing and privacy-suppressed values render as em dash/gaps, never zero.
- Estimated proceeds remain labeled as Analytics estimates and never as finalized payouts.
- Apple Ads disconnection may remove paid-acquisition context but must not make App Store Analytics unavailable.
- If AI explanation is added later, it receives only selected canonical aggregate facts, cites exact evidence IDs, performs no new math, and cannot create a plan or write to Apple.
