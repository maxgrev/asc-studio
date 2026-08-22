import { describe, expect, it } from "vitest";
import { MockAscProvider } from "./index.js";

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
