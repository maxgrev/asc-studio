---
version: 1
slug: "apps-web-src-components-storelistingworkspace-tsx"
primary_target: "apps/web/src/components/StoreListingWorkspace.tsx"
related_targets: ["apps/web/src/App.tsx","apps/web/src/components/Sidebar.tsx","apps/web/src/components/ReleaseWorkspace.tsx","apps/web/src/components/ReleaseDialogs.tsx","apps/web/src/components/ScreenshotManager.tsx","apps/web/src/releaseMetadata.ts","apps/web/src/styles.css","apps/web/index.html","packages/contracts/src/index.ts","packages/core/src/index.ts","packages/provider-app-store-connect/src/index.ts","packages/provider-demo/src/index.ts"]
---

# Store Listing

## Purpose

Store Listing is a separate top-level workspace and the canonical home for version-localized description, promotional text, keywords, marketing and support URLs, and screenshots. Releases owns versions, builds, What’s New, readiness, submission, and status without duplicating these editors.

## Structure

The fixed shell opens onto a platform/version scope strip and two content modes: Copy & search and Screenshots. Copy & search is one bordered master-detail workbench with a locale rail, focused editor, and representative product-page copy preview. On desktop and mobile, the first viewport exposes the active version state, local draft count, and review action; locale context remains visible with the editor.

## Interaction

Copy edits become session-durable local drafts immediately and survive workspace navigation. Each locale draft persists exact changed-field intent; planning merges only those fields into current App Store Connect state, preventing a stale Store Listing draft from overwriting newer What’s New and preventing a stale Releases draft from overwriting storefront copy. Releases surfaces pending storefront work and blocks submission until it is reviewed or reverted. Review changes creates the guarded localization mutation plan; confirmation re-reads App Store Connect and stops if the reviewed baseline changed. Screenshot writes continue through their guarded screenshot-set plan and remain staged across Copy & search/Screenshots switches. Leaving Store Listing requires explicit discard confirmation while screenshot work is staged, and departure is hard-blocked while a confirmed screenshot plan is applying. Release readiness opens the exact version, locale, and failing field; Apple Ads keyword handoff opens the exact Keywords field.

## Responsive behavior

At narrow widths the preview is removed, storefront locales become a horizontal rail, and fields stack. Version state and draft count stay in the compact first-viewport context, while Review changes moves into that context and the full-width bottom status dock. The editor remains full-width with 16px form text and no horizontal page overflow.

## Visual world

Extend ASC Studio’s Calm Operations Console: flat white or dark surfaces, neutral hairlines, compact Inter typography, blue selection/action, semantic status, restrained radii, and no decorative dashboard cards.
