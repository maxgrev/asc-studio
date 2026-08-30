---
version: 1
slug: "apps-web-src-components-releaseworkspace-tsx"
primary_target: "apps/web/src/components/ReleaseWorkspace.tsx"
related_targets: ["apps/web/src/App.tsx","apps/web/src/components/Sidebar.tsx","apps/web/src/components/ReleaseMetadataWorkbench.tsx","apps/web/src/components/ReleaseDialogs.tsx","apps/web/src/components/ScreenshotManager.tsx","apps/web/src/releaseDraftState.ts","apps/web/src/releaseMetadata.ts","apps/web/src/styles.css","apps/web/index.html","packages/contracts/src/index.ts","packages/core/src/index.ts","packages/provider-app-store-connect/src/index.ts","packages/provider-demo/src/index.ts"]
---

# Releases

## Purpose

Releases is the single version-scoped workspace for App Store delivery. It joins localized description, promotional text, What’s New, keywords, URLs, screenshots, build selection, readiness, submission, and status without a second metadata destination.

## Structure

The fixed shell opens onto one platform/version/build strip and two internal modes: Localized content and Screenshots. Localized content is one bordered master-detail workbench with a locale rail and a full six-field editor. The submission dock remains present beneath either mode. On desktop and mobile, the first viewport exposes version state, local draft count, and the exact review action.

## Interaction

Content edits become session-durable local drafts immediately. Every locale retains exact changed-field intent; planning merges only those fields into fresh App Store Connect state. A new version copies each locale’s stable content from the selected prior version and leaves What’s New empty by default. Translate & adapt can fill any selected description, promotional text, What’s New, or keyword fields; keywords are adapted for local search, while selected URLs are copied unchanged without leaving the device. Generated content remains local until the exact diff is reviewed. Screenshot staging remains mounted across internal mode switches, requires explicit discard before leaving Releases, and hard-blocks departure while a confirmed plan is applying. Readiness and Apple Ads focus the exact locale and field in this workspace.

## Responsive behavior

At narrow widths, locales become a horizontal rail and fields stack inline with 16px form text. Platform, version, build, status, draft count, and Review changes remain in the first viewport without horizontal page overflow. The same content and safety states remain available in dark mode.

## Visual world

Extend ASC Studio’s Calm Operations Console: flat white or dark surfaces, neutral hairlines, compact Inter typography, blue selection/action, semantic status, restrained radii, and no decorative dashboard cards.
