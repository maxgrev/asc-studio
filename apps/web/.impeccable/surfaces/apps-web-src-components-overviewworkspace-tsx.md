---
version: 1
slug: "apps-web-src-components-overviewworkspace-tsx"
primary_target: "apps/web/src/components/OverviewWorkspace.tsx"
related_targets: ["apps/web/src/App.tsx","apps/web/src/components/Sidebar.tsx","apps/web/src/api.ts","apps/web/src/styles.css"]
---

# Overview workspace

## Scope and mode

- Scope: the `OverviewWorkspace` surface and its Sidebar/App integration.
- Mode: Operate.
- Audience and job: an app operator opening ASC Studio to understand the selected app’s release, TestFlight, Apple Ads, and recent workspace state, then enter the right existing workspace.
- Primary action: choose the lane that needs work; Refresh performs pure reads only.

## Content and constraints

- Use live App Store Connect builds and all-platform versions, Apple Ads campaign status, unexpired pending plans, and local audit activity.
- Activity and pending plans are workspace-wide and must be labeled that way.
- Treat lanes independently so one failed service does not hide successful data.
- Do not call audited `sync` or validation operations from Overview.
- Do not claim downloads, revenue, conversion, ratings, health scores, trends, or app-scoped activity.
- Preserve the existing Releases landing default until ASC Studio has mobile navigation.

## Chosen composition

- Direction: Operations Matrix, approved from `.impeccable/mocks/decision/overview-operations-matrix.webp`.
- Seed: `186d157e`; chosen surface candidate 7 of 7.
- Memorable moment: one asymmetric matrix puts Release and Apple Ads in wider lanes, TestFlight and recent workspace activity in narrower lanes, with one factual next action per lane.
- Non-literal parts: the generated demo audit copy and “all systems operational” footer are not product facts. Real API results and an honest workspace-plan status replace them.

## Implementation inventory

| Visible ingredient | Commitment | Medium |
| --- | --- | --- |
| Existing shell and sidebar | 276px desktop rail; current app/account controls; Overview active | Existing React, CSS, Lucide |
| Header and demo banner | Existing 121px topbar; title/subtitle; secondary Refresh; incumbent demo notice | Semantic React and existing tokens |
| Operations matrix | Asymmetric two-column grid; wide Release/Ads lanes and narrow TestFlight/Activity lanes; stacks responsively | CSS Grid |
| Release lane | Dominant panel; editable releases and localization readiness when available; clear Releases action | Semantic rows and API data |
| TestFlight lane | Latest builds, processing/testing state, upload timing, group counts | Semantic rows and API data |
| Apple Ads lane | Connection, campaign enabled/paused counts, daily budgets grouped by currency | Semantic rows and API data |
| Workspace activity lane | Latest local audit events, explicitly workspace-wide | Semantic list and API data |
| Bottom status strip | Unexpired workspace-plan count or honest empty state; no computed health claim | Semantic status region |
| Loading and partial failure | Stable skeletons; lane-local errors and Retry without clearing successful lanes | React state and existing shimmer grammar |

## Component grammar sampled from the approved comp

- Ground: generated comp clusters around `#0f151a`; implementation keeps incumbent `--bg` (`#0d0f13` dark).
- Dominant surfaces: generated comp clusters around `#181e25` and `#191f26`; implementation keeps incumbent `--surface` (`#171a20` dark).
- Ink and accents: incumbent `--text`, `--muted`, `--accent`, `--success`, `--warning`, and `--danger` remain authoritative.
- Corners: 8px panels and 7px controls; 1px hairline borders; no panel shadows, gradients, glass, or decorative rasters.
- Type: existing Inter/system UI ramp; topbar h1 is the largest text; compact 11–16px operating rows.

## Unresolved decisions

- Activity cannot be scoped to one app until audit events carry structured app/account identifiers.
- Overview will not deep-link into a pending plan until the destination workspace can safely rehydrate it.
