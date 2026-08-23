# ADR 0004: Build portfolio analytics from verified report partitions

Status: accepted
Date: 2026-08-22

## Context

App Store Connect Analytics is organized around many report families, delayed processing, expiring signed segments, privacy thresholds, and corrected batches. Mirroring that report hierarchy in the GUI would reproduce the complexity ASC Studio is meant to remove. Querying raw reports in the browser would also expose transport details, make portfolio aggregation unreliable, and encourage invalid sums of row-level unique counts.

The product needs one reliable answer path: start with the whole portfolio, identify which apps moved it, and narrow into one app without changing the date, comparison, or metric definition.

## Decision

ASC Studio uses a separate Analytics provider and local fact store rather than treating Analytics Reports as ordinary App Store Connect resources.

- The first slice ingests only the Standard daily Discovery and Engagement, Downloads, Pre-Orders, Purchases, and Sessions report families.
- Analytics Reports requests are explicit external writes. Ongoing and one-time snapshot requests use the existing expiring plan, exact review, stale check, account binding, one-time confirmation, and audit path.
- Sync runs in the background and is pollable. It holds an account read lease so the active credential cannot switch while Apple data is being downloaded.
- Signed segment URLs stay inside the provider and receive no App Store Connect authorization header. The downloader requires HTTPS, blocks unsafe hosts and redirects, bounds compressed and decompressed data, and verifies Apple's declared byte size and MD5 checksum.
- The importer reads columns by normalized header name, accepts reordered or additional columns, and rejects missing required fields, invalid types, wrong-app rows, unsupported Detailed reports, or an incomplete segment set.
- Facts remain invisible until every segment in an instance validates. Publication then promotes complete date partitions atomically.
- A partition is keyed by issuer, app, logical report identity, granularity, and event date. A newer `processingDate` replaces the older batch; equal-date ongoing data wins over a snapshot. Request-specific report IDs remain provenance and never cause duplicate totals.
- Cached facts and sync runs are scoped by Apple issuer and app. A restart marks abandoned queued/running work as interrupted while preserving the last complete partitions.
- The public read model returns one versioned portfolio or app snapshot with KPI values, aligned series, ranked breakdowns, app contributions, freshness, privacy, per-metric coverage, and provenance. It never returns raw Apple rows or signed URLs.
- Territory, source, page type, and version filters are typed exact-value constraints applied in the local fact query. The response returns bounded, sorted facets from the unfiltered app/date scope so the browser never needs raw facts to build its filter controls.

The MVP exposes Impressions, First-time downloads, Total downloads, Product page views, Sessions, and Estimated proceeds as additive values. Download rate is derived as Total downloads ÷ Product page views and is recomputed from aggregate numerators and denominators. Row-level `Unique Counts`, `Unique Devices`, and `Paying Users` are not summed. Null availability is explicit, so absent, partial, and privacy-withheld data cannot silently become zero.

## Consequences

The default GUI can truthfully aggregate the active organization's complete app roster and rank the apps behind a portfolio change. Selecting an app reuses the same normalized evidence model for territory, source, page type, and version drill-downs instead of exposing Apple's report menu.

This design adds a local SQLite analytics cache and ingestion lifecycle. Manual synchronization is distinct from refreshing the cached view. Recent values may remain partial because Apple report families have different processing delays, and Sessions remains subject to usage opt-in and privacy processing. Estimated proceeds are labeled as App Analytics estimates rather than finalized payments.

Detailed reports, non-additive unique-user KPIs, cohorts, peer benchmarks, Sales and Trends, financial reconciliation, Apple Ads joins, scheduled sync, exports, and AI explanations remain separate slices. They must extend the normalized evidence model without weakening its source, freshness, privacy, or aggregation rules.
