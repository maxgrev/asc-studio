---
name: "ASC Studio"
description: "A precise, calm visual system for local Apple operations."
colors:
  background-light: "#f7f8fa"
  surface-light: "#ffffff"
  text-light: "#15171b"
  muted-light: "#656b76"
  border-light: "#dfe3e8"
  border-strong-light: "#cfd5dd"
  accent-light: "#1464e8"
  accent-soft-light: "#ebf3ff"
  success-light: "#42a348"
  warning-light: "#e69512"
  danger-light: "#d84444"
  background-dark: "#0d0f13"
  surface-dark: "#171a20"
  text-dark: "#f2f4f7"
  muted-dark: "#a6adb8"
  border-dark: "#2a2f38"
  border-strong-dark: "#3a414d"
  accent-dark: "#79adff"
  accent-soft-dark: "#182b48"
  success-dark: "#65c970"
  warning-dark: "#eeb245"
  danger-dark: "#ff747c"
typography:
  display:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "34px"
    fontWeight: 720
    letterSpacing: "-0.045em"
  headline:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "22px"
    fontWeight: 690
    letterSpacing: "-0.025em"
  title:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "0.055em"
  mono:
    fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, monospace'
    fontSize: "12px"
    fontWeight: 400
rounded:
  compact: "6px"
  control: "7px"
  panel: "8px"
  prominent-control: "9px"
  overlay: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.surface-light}"
    typography: "{typography.body}"
    rounded: "{rounded.panel}"
    padding: "0 17px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    typography: "{typography.body}"
    rounded: "{rounded.panel}"
    padding: "0 17px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "40px"
  nav-item:
    textColor: "{colors.text-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 17px"
    height: "49px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft-light}"
    textColor: "{colors.accent-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 17px"
    height: "49px"
  segmented-active:
    backgroundColor: "{colors.accent-soft-light}"
    textColor: "{colors.accent-light}"
    typography: "{typography.body}"
    rounded: "{rounded.compact}"
    padding: "0 17px"
    height: "37px"
  panel:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.panel}"
    padding: "16px"
  dialog:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.overlay}"
    width: "min(540px, 100%)"
  status-dot-success:
    backgroundColor: "{colors.success-light}"
    rounded: "{rounded.overlay}"
    size: "9px"
---

# Design System: ASC Studio

## Overview

**Creative North Star: "The Calm Operations Console"**

The Calm Operations Console treats ASC Studio as a working instrument: information leads, framing recedes, and the interface stays legible under operational density. Light and dark themes use paired neutrals, hairlines, and blue selection to make current context obvious without turning status into decoration.

The system is precise, calm, and operational. Persistent surfaces stay flat; compact tables and rows carry most workflow state; semantic color marks real status only. Identity comes from consistency in spacing, type, and interaction restraint.

**Key Characteristics:**

- Calm, desktop-grade operational density.
- Paired light and dark theme roles.
- Blue for action, focus, selection, and in-progress state.
- Semantic dots and labels for success, warning, and danger.
- Flat persistent surfaces divided by thin hairlines.
- Compact system typography, controls, tables, and rows.

## Colors

The palette is a paired daylight-and-night system whose roles remain stable across themes.

### Primary

- **Operator Blue:** `accent-light` and `accent-dark` identify actions, focus, active navigation, selected rows, and in-progress state.
- **Selection Wash:** `accent-soft-light` and `accent-soft-dark` provide a quiet selected background without competing with operational content.

### Neutral

- **Canvas:** `background-light` and `background-dark` establish the application ground.
- **Work Surface:** `surface-light` and `surface-dark` carry workspaces, controls, tables, and persistent panels.
- **Primary Ink:** `text-light` and `text-dark` carry headings and factual content.
- **Secondary Ink:** `muted-light` and `muted-dark` carry supporting labels, timestamps, and explanatory copy.
- **Hairlines:** `border-light` / `border-dark` separate rows and panels; the strong variants frame interactive controls.

### Semantic Status

- **Ready Green:** the success pair marks completed, connected, ready, or successful states.
- **Attention Amber:** the warning pair marks missing, paused, pending, or review-needed states.
- **Blocking Red:** the danger pair marks errors, disconnected state, destructive actions, or blocked work.

**The Theme Pair Rule.** Choose every role from one theme set; never combine daylight and night tokens on the same surface.

**The One Semantic Meaning Rule.** Blue indicates action, focus, selection, or progress; green means ready or successful; amber means attention; red means blocked, failed, or destructive. Pair semantic color with text rather than relying on color alone.

## Typography

**Display Font:** Inter (with ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)

**Body Font:** Inter (with ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)

**Mono Font:** SFMono-Regular (with Cascadia Code, Roboto Mono, Consolas, monospace)

**Character:** The Inter-first system stack is compact and neutral, with tight tracking on major headings and sturdy weights on labels. Monospaced text is reserved for identifiers, timestamps, commands, and fixed-format technical values.

### Hierarchy

- **Display** (Inter/system UI, 720, 34px, -0.045em): Workspace titles in the primary topbar.
- **Headline** (Inter/system UI, 690, 22px, -0.025em): Major regions and high-level task headings.
- **Title** (Inter/system UI, 700, 17px, -0.02em): Panel, inspector, and dialog section titles.
- **Body** (Inter/system UI, 400, 14px): Primary operating copy, navigation, and table content.
- **Label** (Inter/system UI, 650, 11px, 0.055em when uppercase): Compact field, menu, and metadata labels; uppercase is reserved for short structural labels.
- **Mono** (system mono, 400, 12px): Technical identifiers, timestamps, commands, and counts whose shape matters.

**The Scan First Rule.** Keep headings short, labels compact, and values visually firmer than their descriptors so a workspace reads in vertical and tabular passes.

## Layout

The desktop shell starts with a fixed 276px navigation rail and a flexible workspace. At 1220px the rail narrows to 220px, at 820px it becomes a 74px icon rail, and at 620px it is removed while the workspace becomes a flowing mobile document. Standard workspace topbars are 121px tall; supporting copy and button labels progressively collapse as width tightens.

Use the compact spacing rhythm in the frontmatter for internal gaps and padding. Persistent operating regions favor grids, aligned definition lists, and tables over isolated summary blocks. Tables may scroll, reduce nonessential columns, or reflow metadata on small screens, but the labels needed to interpret a value remain visible.

**The Preserve Context Rule.** Collapse navigation chrome and secondary labels before removing the status, scope, or units that make operational data trustworthy.

## Elevation & Depth

ASC Studio is flat by default. Persistent panels, tables, docks, and inspectors establish depth with paired surfaces and 1px borders, not shadows. Dialogs are the elevated layer and use the dedicated dialog shadow; the rest of the workspace should remain visually anchored.

### Shadow Vocabulary

- **Dialog Light:** a broad, quiet shadow for modal separation in the light theme.
- **Dialog Dark:** a deeper black shadow that preserves the same modal hierarchy in the dark theme.

**The Flat-by-Default Rule.** If a surface persists in the workspace, separate it with tone and a hairline; reserve elevation for dialogs.

## Shapes

The form language is gently squared and compact. Core controls use the control and panel radii, most persistent panels use the panel radius, and prominent selectors may use the prominent-control radius. Dialogs use the larger overlay radius. Boundaries are normally 1px solid hairlines, while circles are reserved for status dots, radio controls, and compact icon marks.

**The Tight Radius Rule.** Keep ordinary controls and panels within the established 7–9px range; use the larger overlay radius only for dialogs.

## Components

### Buttons

- **Shape:** A 44px control with the panel radius and compact horizontal padding.
- **Primary:** Solid Operator Blue with white text; use for the committing or forward action in a group.
- **Secondary:** Work Surface with a strong hairline and Primary Ink; use for reads, cancellation, and supporting actions.
- **Hover / Focus:** Shift fill or border in 140ms, show the shared blue focus outline, and use a restrained 0.98 active scale. Disabled controls remain visible at reduced opacity.

### Inputs / Fields

- **Style:** Work Surface, Primary Ink, a strong hairline, and the control radius. Standard compact fields are 40–45px tall.
- **Focus:** Move the border toward Operator Blue and add a low-opacity 3px blue halo.
- **Error / Disabled:** Use Blocking Red for errors and muted text plus a quiet neutral fill for disabled state.

### Navigation

- **Style:** Navigation rows are 49px tall with the control radius. Default rows are transparent; the active row uses Selection Wash, Operator Blue, and a firmer weight.
- **Responsive treatment:** The full rail narrows, becomes icon-only, then disappears at the documented shell breakpoints.

### Segmented Controls

- **Style:** A bordered 45px frame with 3px inset padding. Inner options are 37px tall with the compact radius.
- **State:** Hover uses a neutral fill; the active option uses Selection Wash and Operator Blue.

### Cards / Containers

- **Corner Style:** The panel radius is the persistent default.
- **Background:** Work Surface over Canvas, with theme-matched text.
- **Shadow Strategy:** None for persistent surfaces.
- **Border:** A 1px Hairline, strengthened only when the whole surface is interactive.
- **Internal Padding:** Usually 12–18px, following the compact spacing rhythm.

### Tables / Rows

- **Style:** Compact aligned columns, quiet header labels, and 1px row separators. Dense subtables may use shorter rows than primary workspace tables.
- **State:** Hover changes tone only; selection uses a soft blue row and a narrow blue inset edge.
- **Content:** Keep units, locale codes, timestamps, and status labels close to the values they qualify.

### Status Indicators

- **Style:** A 9px semantic dot paired with a plain-language label.
- **State:** Use the success, warning, danger, or blue progress role according to the factual state; neutral or unavailable state uses muted ink.

### Dialogs

- **Style:** A centered overlay with the overlay radius, 1px boundary, dedicated dialog shadow, and separated header, content, and footer regions.
- **Behavior:** Keep the exact change or decision visible near the final action and preserve keyboard focus treatment.

## Do's and Don'ts

### Do:

- **Do** choose the complete light or dark token set before styling a surface.
- **Do** reserve blue for actions, focus, selection, and in-progress state.
- **Do** pair every semantic dot or color with a text label.
- **Do** use one-pixel hairlines and compact rows to organize operational data.
- **Do** preserve the 1220px, 820px, and 620px responsive behaviors when extending the shell.
- **Do** keep motion to short state changes in transform, opacity, background, or border.

### Don't:

- **Don't** add shadows to persistent panels, tables, or docks.
- **Don't** mix light-theme and dark-theme token roles on the same surface.
- **Don't** replace factual status language with decorative scores, trends, or visual claims.
- **Don't** enlarge controls or spacing until the operating density stops reading as a desktop tool.
- **Don't** animate layout for decoration or ignore reduced-motion preferences.
