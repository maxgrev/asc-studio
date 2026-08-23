import { describe, expect, it } from "vitest";
import { AnalyticsFactBatchSchema, AnalyticsSyncResultSchema } from "@asc-studio/contracts";
import { MockAscProvider, demoAnalyticsFactBatches } from "./index.js";

describe("MockAscProvider analytics", () => {
  it("returns a deterministic whole-portfolio sync with complete segment evidence", async () => {
    const provider = new MockAscProvider();
    const result = await provider.syncAnalytics({
      schemaVersion: 1,
      appIds: ["demo-app-orbit-notes", "demo-app-field-log"],
      force: false,
    });

    expect(() => AnalyticsSyncResultSchema.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      issuerId: "demo-issuer",
      state: "SUCCEEDED",
      appIds: ["demo-app-orbit-notes", "demo-app-field-log"],
      freshness: { dataThrough: "2026-08-17", partial: true },
    });
    expect(result.batches).toHaveLength(8);
    expect(result.batches.every((batch) => (
      batch.expectedSegmentCount === batch.verifiedSegmentCount
      && batch.segmentIds.length === batch.segments.length
    ))).toBe(true);
  });

  it("includes both app-level movement and an explicit privacy-limited usage state", () => {
    const batches = demoAnalyticsFactBatches();
    batches.forEach((batch) => expect(() => AnalyticsFactBatchSchema.parse(batch)).not.toThrow());

    const orbitDownloads = batches
      .flatMap((batch) => batch.observations)
      .filter((observation) => observation.appId === "demo-app-orbit-notes" && observation.metric === "DOWNLOADS");
    const fieldSessions = batches
      .flatMap((batch) => batch.observations)
      .filter((observation) => observation.appId === "demo-app-field-log" && observation.metric === "SESSIONS");
    const orbitFirstTime = batches
      .flatMap((batch) => batch.observations)
      .filter((observation) => observation.appId === "demo-app-orbit-notes" && observation.metric === "FIRST_TIME_DOWNLOADS");
    const orbitImpressions = batches
      .flatMap((batch) => batch.observations)
      .filter((observation) => observation.appId === "demo-app-orbit-notes" && observation.metric === "IMPRESSIONS");
    const beforeRelease = orbitDownloads
      .filter((observation) => observation.date === "2026-08-05")
      .reduce((sum, observation) => sum + observation.value!, 0);
    const afterRelease = orbitDownloads
      .filter((observation) => observation.date === "2026-08-06")
      .reduce((sum, observation) => sum + observation.value!, 0);

    expect(afterRelease).toBeGreaterThan(beforeRelease);
    expect(orbitFirstTime.length).toBeGreaterThan(0);
    expect(orbitImpressions.length).toBeGreaterThan(0);
    expect(fieldSessions).toContainEqual(expect.objectContaining({
      availability: "PRIVACY_WITHHELD",
      value: null,
      dimensions: expect.objectContaining({ territory: "JPN" }),
    }));
  });

  it("uses only Standard Page Type categories with metric-appropriate discovery values", () => {
    const observations = demoAnalyticsFactBatches().flatMap((batch) => batch.observations);
    const pageTypes = observations.map((observation) => observation.dimensions.productPage);
    const productPageViews = observations.filter((observation) => observation.metric === "PRODUCT_PAGE_VIEWS");
    const impressions = observations.filter((observation) => observation.metric === "IMPRESSIONS");

    expect([...new Set(pageTypes)].sort()).toEqual([
      "In-App Event",
      "No Page",
      "Product Page",
      "Store Sheet",
    ]);
    expect(productPageViews.length).toBeGreaterThan(0);
    expect(productPageViews.every((observation) => observation.dimensions.productPage === "Product Page")).toBe(true);
    expect(impressions.length).toBeGreaterThan(0);
    expect(impressions.every((observation) => (
      observation.dimensions.productPage === "Product Page"
      || observation.dimensions.productPage === "No Page"
    ))).toBe(true);
  });

  it("returns isolated clones and supports report-request creation for setup-plan confirmation", async () => {
    const provider = new MockAscProvider();
    const before = await provider.listAnalyticsReportRequests("demo-app-orbit-notes");
    before[0]!.id = "caller-mutation";
    await expect(provider.listAnalyticsReportRequests("demo-app-orbit-notes"))
      .resolves.toMatchObject([{ id: "demo-analytics-request-1", accessType: "ONGOING" }]);

    await expect(provider.createAnalyticsReportRequest({
      appId: "demo-app-orbit-notes",
      accessType: "ONE_TIME_SNAPSHOT",
    })).resolves.toMatchObject({ appId: "demo-app-orbit-notes", accessType: "ONE_TIME_SNAPSHOT" });
    await expect(provider.listAnalyticsReportRequests("demo-app-orbit-notes"))
      .resolves.toHaveLength(2);
  });
});

describe("MockAscProvider customer reviews", () => {
  it("serves deterministic review fixtures and an intentionally empty app", async () => {
    const provider = new MockAscProvider();

    const orbitPage = await provider.listCustomerReviews("demo-app-orbit-notes");
    expect(orbitPage).toMatchObject({ total: 8, nextCursor: null });
    expect(orbitPage.reviews).toHaveLength(8);
    expect(orbitPage.reviews.slice(0, 2)).toEqual([
      expect.objectContaining({ id: "demo-review-orbit-001", rating: 5, territory: "USA" }),
      expect.objectContaining({ id: "demo-review-orbit-002", rating: 4, territory: "GBR" }),
    ]);
    await expect(provider.listCustomerReviews("demo-app-field-log")).resolves.toEqual({
      reviews: [],
      total: 0,
      nextCursor: null,
    });
  });

  it("filters, sorts, and pages reviews with opaque cursors", async () => {
    const provider = new MockAscProvider();

    await expect(provider.listCustomerReviews("demo-app-orbit-notes", {
      ratings: [5],
      territories: ["USA", "JPN"],
      publishedResponse: true,
      sort: "rating",
    })).resolves.toMatchObject({
      total: 2,
      reviews: [
        { id: "demo-review-orbit-001", response: { state: "PUBLISHED" } },
        { id: "demo-review-orbit-005", response: { state: "PUBLISHED" } },
      ],
    });

    const first = await provider.listCustomerReviews("demo-app-orbit-notes", {
      limit: 2,
      sort: "rating",
      publishedResponse: false,
    });
    expect(first.total).toBe(5);
    expect(first.reviews.map((review) => review.rating)).toEqual([1, 2]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toContain("customer-reviews");

    const second = await provider.listCustomerReviews("demo-app-orbit-notes", {
      limit: 2,
      cursor: first.nextCursor!,
      sort: "rating",
      publishedResponse: false,
    });
    expect(second.reviews.map((review) => review.rating)).toEqual([3, 4]);
    expect(new Set([...first.reviews, ...second.reviews].map((review) => review.id)).size).toBe(4);
  });

  it("creates and replaces pending responses without leaking mutable fixtures", async () => {
    const provider = new MockAscProvider();
    const original = await provider.getCustomerReview("demo-app-orbit-notes", "demo-review-orbit-002");
    expect(original.response).toBeNull();

    const created = await provider.upsertCustomerReviewResponse(
      "demo-review-orbit-002",
      "Thank you — compact outlines are on our list.",
    );
    expect(created).toEqual({
      id: "demo-review-response-orbit-002",
      reviewId: "demo-review-orbit-002",
      responseBody: "Thank you — compact outlines are on our list.",
      lastModifiedAt: "2026-08-21T12:00:00.000Z",
      state: "PENDING_PUBLISH",
    });

    created.responseBody = "mutated by caller";
    const afterCreate = await provider.getCustomerReview("demo-app-orbit-notes", "demo-review-orbit-002");
    expect(afterCreate.response?.responseBody).toBe("Thank you — compact outlines are on our list.");

    const replaced = await provider.upsertCustomerReviewResponse(
      "demo-review-orbit-001",
      "Updated public reply.",
    );
    expect(replaced).toMatchObject({
      id: "demo-review-response-orbit-001",
      reviewId: "demo-review-orbit-001",
      responseBody: "Updated public reply.",
      state: "PENDING_PUBLISH",
    });
    const afterReplace = await provider.getCustomerReview("demo-app-orbit-notes", "demo-review-orbit-001");
    expect(afterReplace.response).toEqual(replaced);

    afterReplace.response!.responseBody = "another caller mutation";
    await expect(provider.getCustomerReview("demo-app-orbit-notes", "demo-review-orbit-001"))
      .resolves.toMatchObject({ response: { responseBody: "Updated public reply." } });
  });

  it("rejects invalid review pagination inputs", async () => {
    const provider = new MockAscProvider();

    await expect(provider.listCustomerReviews("demo-app-orbit-notes", { limit: 201 }))
      .rejects.toThrow("between 1 and 200");
    await expect(provider.listCustomerReviews("demo-app-orbit-notes", { cursor: "not-a-cursor" }))
      .rejects.toThrow("cursor is invalid");
  });
});
