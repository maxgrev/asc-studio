---
version: 1
slug: "apps-web-src-components-subscriptionsworkspace-tsx"
primary_target: "apps/web/src/components/SubscriptionsWorkspace.tsx"
related_targets: ["apps/web/src/App.tsx","apps/web/src/components/Sidebar.tsx","apps/web/src/api.ts","apps/web/src/styles.css","apps/web/index.html","packages/contracts/src/index.ts","packages/core/src/index.ts","packages/core/src/subscription-pricing.ts","packages/core/src/subscription-price-levels.ts","packages/provider-app-store-connect/src/index.ts","packages/provider-demo/src/index.ts","apps/local-agent/src/index.ts"]
---

# Subscriptions workspace

## Scope and mode

- Scope: the `SubscriptionsWorkspace` surface, its Sidebar/App integration, and the direct provider/core plan path it operates.
- Mode: Operate.
- Audience and job: an app operator audits current auto-renewable subscription prices, chooses a trusted base storefront, creates a conservative purchasing-power adjustment, inspects every exact local-currency price point, and schedules only that reviewed diff.
- Primary action: build an exact price review; confirmation remains a separate checked action after the storefront table is inspected.

## Content and truth constraints

- Use App Store Connect auto-renewable subscriptions, subscription price points, equalizations, and complete current/future price schedules for the selected app and product.
- Apple's equalization for the current base price point is the comparable-price baseline. Do not describe it as purchasing-power parity.
- Purchasing-power evidence is the dated repository snapshot of World Bank World Development Indicators `PA.NUS.PPP / PA.NUS.FCRF`, using the latest common non-null year retrieved on 2026-09-03. Show the target territory's evidence year in the exact review.
- Normalize each territory's price-level ratio to the chosen base storefront. Cap relative ratios above one at 100% so this policy never invents a purchasing-power surcharge.
- The policy factor is `100 - (100 - bounded relative ratio × 100) × strength`. Apply the configurable revenue floor, then round upward to a 5-point band. Select the first actual base-storefront Apple price point at or above that target and use Apple's exact equalizations for local results.
- Defaults are Balanced strength (50% of the measured gap) and a 70% floor. The operator may choose Careful (25%), Balanced (50%), Stronger (75%), or a 60–90% floor before planning.
- Never guess missing price-level evidence or a missing/currency-mismatched Apple equalization. Hold that storefront at its current price.
- Never overwrite a territory with an existing future schedule. Mark it protected and exclude it from the write plan.
- Price raises preserve the current subscriber price. Price decreases do not use preservation. Both remain explicit in the exact diff.
- Effective dates must be valid future dates from 2 through 180 days after planning.
- A plan expires in ten minutes, is bound to the active App Store Connect connection, captures the full exact price schedule, and re-reads it before confirmation. Any difference fails closed as stale.
- Apple writes are non-retried future `subscriptionPrices` creates. If one change fails, remove every schedule created by that attempt; if removal cannot be verified, report the uncertain rollback and require manual App Store Connect review.
- Demo mode uses isolated deterministic products and prices and never contacts Apple.

## Chosen composition

- Direction: Guarded parity pricing workbench, code-led extension of the established Calm Operations Console.
- Seed: `subscriptions-parity-v1`.
- Memorable moment: the policy is one compact operational strip above a literal storefront ledger; the floor intervention, evidence year, Apple comparable price, recommendation, and write result can be read across one row.
- Refusals: no generic monetization dashboard, revenue forecast, demand claim, map, purchasing-power score tile, or automatic one-click global repricing.

## Implementation inventory

| Visible ingredient | Commitment | Medium |
| --- | --- | --- |
| Existing shell and sidebar | Subscriptions is an available first-class workspace between Releases and Apple Ads | Existing React, CSS, Lucide |
| Header and demo banner | Existing 121px topbar, precise purchasing-power/floor subtitle, secondary Refresh, incumbent demo notice | Semantic React and existing tokens |
| Pricing policy | Product, base storefront, three strength choices, 60–90% floor, 2–180 day date, one Build price review action | Native controls in one bordered strip |
| Method line | World Bank source, missing-data hold, and existing-schedule protection are visible before planning | Compact inline operational copy |
| Current price ledger | Every effective storefront price plus any pending schedule state before a review exists | Scrollable semantic table |
| Exact review | Storefront name/code/currency, current price, Apple comparable, rounded band, policy reason/year, exact recommendation, and result | Plan-backed semantic table with filters |
| Review summary | Changes, decreases, preserved raises, floor-protected count, and held-back count | One contiguous summary rail, not independent KPI cards |
| Confirmation | Exact-change count, stale re-check promise, explicit reviewed checkbox, and future schedule action | Persistent bottom dock |
| States | Loading, refreshing, planning, applying, empty subscription list, empty filter, error/dismiss, success/dismiss, and disabled actions | React state and accessible status regions |

## Responsive behavior

- Desktop: the compact policy strip and storefront ledger share the remaining shell width. The exact review keeps six aligned columns and a persistent confirmation dock.
- Compact desktop/tablet: policy fields reflow to two or three columns without horizontal clipping; the ledger remains horizontally scrollable where necessary.
- Phone: the sidebar becomes the incumbent workspace selector, the policy becomes one readable field stack, the exact ledger becomes labeled two-column records, and the confirmation dock remains sticky with full action copy.
- After planning, move focus to the exact-review heading and scroll that review into view. Respect reduced-motion preference.
- The mobile confirmation dock may cover only the scrolling edge; all records remain reachable and no policy or price value relies on hover.

## Component grammar

- Inherit `--bg`, `--surface`, neutral hairlines, compact 7–10px radii, blue selection/action, and semantic guardrail colors in both light and dark modes.
- Use the product type ramp: 34px/29px page heading, 18px section heading, 12–13px values and body, and 10–11px labels/metadata. Keep monetary numerals tabular.
- Panels remain flat. The only elevation is the soft upward shadow on the persistent confirmation dock.
- Use Lucide icons consistently; no emoji, gradients, decorative raster assets, map ornament, progress rings, or nested card grids.

## Future boundaries

- Subscription groups, offers, offer codes, introductory pricing, availability, localized metadata, in-app purchases, and StoreKit configuration export remain separate workflows.
- General country price levels are conservative pricing evidence, not app-specific demand, willingness-to-pay, income, conversion, or revenue evidence. Never present forecasted lift.
- The first slice is GUI-operated. A future MCP surface may list subscription prices or prepare the same plan, but cannot bypass trusted local GUI confirmation.
