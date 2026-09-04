import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStoreConnectProvider, type AppStoreConnectCredentials } from "./index.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials: AppStoreConnectCredentials = {
  profileName: "Release key",
  issuerId: "11111111-2222-3333-4444-555555555555",
  keyId: "ABC123DEFG",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  authBackend: "Test memory",
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
});
const page = (data: unknown[], options: { included?: unknown[]; next?: string } = {}) => ({
  data,
  ...(options.included ? { included: options.included } : {}),
  links: { self: "https://api.appstoreconnect.apple.com/v1/test", ...(options.next ? { next: options.next } : {}) },
});
const app = (id: string, name: string) => ({ type: "apps", id, attributes: { name, bundleId: `com.example.${id}` } });

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AppStoreConnectProvider direct transport", () => {
  it("maps subscription groups, products, price points, and storefront schedules", async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/apps/app-1/subscriptionGroups" && init?.method === "GET") {
        return json(page([{ type: "subscriptionGroups", id: "group-pro", attributes: { referenceName: "Pro" } }]));
      }
      if (url.pathname === "/v1/subscriptionGroups/group-pro/subscriptions" && init?.method === "GET") {
        return json(page([{
          type: "subscriptions",
          id: "subscription-yearly",
          attributes: {
            name: "Pro Yearly",
            productId: "com.example.pro.yearly",
            familySharable: true,
            state: "APPROVED",
            subscriptionPeriod: "ONE_YEAR",
            groupLevel: 1,
          },
        }]));
      }
      if (url.pathname === "/v1/subscriptions/subscription-yearly/prices" && init?.method === "GET") {
        expect(url.searchParams.get("filter[planType]")).toBe("UPFRONT");
        return json(page([{
          type: "subscriptionPrices",
          id: "price-us",
          attributes: { startDate: null, preserved: false, planType: "UPFRONT" },
          relationships: {
            territory: { data: { type: "territories", id: "USA" } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-us-120" } },
          },
        }], { included: [{
          type: "territories",
          id: "USA",
          attributes: { currency: "USD" },
        }, {
          type: "subscriptionPricePoints",
          id: "point-us-120",
          attributes: { customerPrice: "119.99", proceeds: "83.99", proceedsYear2: "101.99" },
          relationships: { territory: { data: { type: "territories", id: "USA" } } },
        }] }));
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.listSubscriptions("app-1")).resolves.toEqual([{
      id: "subscription-yearly",
      appId: "app-1",
      groupId: "group-pro",
      groupName: "Pro",
      name: "Pro Yearly",
      productId: "com.example.pro.yearly",
      state: "APPROVED",
      period: "ONE_YEAR",
      groupLevel: 1,
      familySharable: true,
    }]);
    await expect(provider.listSubscriptionPrices("subscription-yearly", "UPFRONT")).resolves.toEqual([{
      id: "price-us",
      subscriptionId: "subscription-yearly",
      territory: "USA",
      currency: "USD",
      customerPrice: "119.99",
      proceeds: "83.99",
      proceedsYear2: "101.99",
      pricePointId: "point-us-120",
      startDate: null,
      preserved: false,
      planType: "UPFRONT",
    }]);
  });

  it("posts exact future subscription price points and verifies the resulting schedule", async () => {
    let scheduled = false;
    let writeBody: unknown;
    const included = [{ type: "territories", id: "GBR", attributes: { currency: "GBP" } }, {
      type: "subscriptionPricePoints",
      id: "point-gb-current",
      attributes: { customerPrice: "99.99", proceeds: "69.99", proceedsYear2: "84.99" },
      relationships: { territory: { data: { type: "territories", id: "GBR" } } },
    }, {
      type: "subscriptionPricePoints",
      id: "point-gb-guarded",
      attributes: { customerPrice: "94.99", proceeds: "66.49", proceedsYear2: "80.74" },
      relationships: { territory: { data: { type: "territories", id: "GBR" } } },
    }];
    const currentPrice = {
      type: "subscriptionPrices",
      id: "price-gb-current",
      attributes: { startDate: null, preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "GBR" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-gb-current" } },
      },
    };
    const scheduledPrice = {
      type: "subscriptionPrices",
      id: "price-gb-scheduled",
      attributes: { startDate: "2026-09-15", preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "GBR" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-gb-guarded" } },
      },
    };
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/subscriptions/subscription-yearly/prices" && init?.method === "GET") {
        return json(page(scheduled ? [currentPrice, scheduledPrice] : [currentPrice], { included }));
      }
      if (url.pathname === "/v1/subscriptionPrices" && init?.method === "POST") {
        writeBody = JSON.parse(String(init.body));
        scheduled = true;
        return json({ data: scheduledPrice, links: { self: `${url}/price-gb-scheduled` } }, 201);
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await provider.applySubscriptionPriceChanges({
      subscriptionId: "subscription-yearly",
      planType: "UPFRONT",
      startDate: "2026-09-15",
      expected: [{
        id: "price-gb-current",
        territory: "GBR",
        currency: "GBP",
        customerPrice: "99.99",
        proceeds: "69.99",
        proceedsYear2: "84.99",
        pricePointId: "point-gb-current",
        startDate: null,
        preserved: false,
        planType: "UPFRONT",
      }],
      changes: [{
        territory: "GBR",
        currency: "GBP",
        pricePointId: "point-gb-guarded",
        customerPrice: "94.99",
        preserveCurrentPrice: false,
      }],
    });

    expect(writeBody).toEqual({
      data: {
        type: "subscriptionPrices",
        attributes: { startDate: "2026-09-15", preserveCurrentPrice: false, planType: "UPFRONT" },
        relationships: {
          subscription: { data: { type: "subscriptions", id: "subscription-yearly" } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-gb-guarded" } },
        },
      },
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("removes newly created subscription schedules when verification fails", async () => {
    let removedId: string | null = null;
    const currentPrice = {
      type: "subscriptionPrices",
      id: "price-us-current",
      attributes: { startDate: null, preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "USA" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-us-current" } },
      },
    };
    const scheduledPrice = {
      type: "subscriptionPrices",
      id: "price-us-created",
      attributes: { startDate: "2026-09-15", preserved: true, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "USA" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-us-higher" } },
      },
    };
    const included = [{ type: "territories", id: "USA", attributes: { currency: "USD" } }, {
      type: "subscriptionPricePoints",
      id: "point-us-current",
      attributes: { customerPrice: "119.99", proceeds: "83.99", proceedsYear2: "101.99" },
      relationships: { territory: { data: { type: "territories", id: "USA" } } },
    }, {
      type: "subscriptionPricePoints",
      id: "point-us-higher",
      attributes: { customerPrice: "129.99", proceeds: "90.99", proceedsYear2: "110.49" },
      relationships: { territory: { data: { type: "territories", id: "USA" } } },
    }];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/subscriptions/subscription-yearly/prices" && init?.method === "GET") {
        return json(page([currentPrice], { included }));
      }
      if (url.pathname === "/v1/subscriptionPrices" && init?.method === "POST") {
        return json({ data: scheduledPrice, links: { self: `${url}/price-us-created` } }, 201);
      }
      if (url.pathname === "/v1/subscriptionPrices/price-us-created" && init?.method === "DELETE") {
        removedId = "price-us-created";
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.applySubscriptionPriceChanges({
      subscriptionId: "subscription-yearly",
      planType: "UPFRONT",
      startDate: "2026-09-15",
      expected: [{
        id: "price-us-current",
        territory: "USA",
        currency: "USD",
        customerPrice: "119.99",
        proceeds: "83.99",
        proceedsYear2: "101.99",
        pricePointId: "point-us-current",
        startDate: null,
        preserved: false,
        planType: "UPFRONT",
      }],
      changes: [{
        territory: "USA",
        currency: "USD",
        pricePointId: "point-us-higher",
        customerPrice: "129.99",
        preserveCurrentPrice: true,
      }],
    })).rejects.toThrow("could not verify the scheduled price for USA");
    expect(removedId).toBe("price-us-created");
    expect(mockFetch).toHaveBeenCalledTimes(7);
  });

  it("discovers and removes a schedule when Apple accepts a POST but its response is lost", async () => {
    let scheduled = false;
    let removedId: string | null = null;
    const currentPrice = {
      type: "subscriptionPrices",
      id: "price-gb-current",
      attributes: { startDate: null, preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "GBR" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-gb-current" } },
      },
    };
    const scheduledPrice = {
      type: "subscriptionPrices",
      id: "price-gb-created",
      attributes: { startDate: "2026-09-15", preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "GBR" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-gb-lower" } },
      },
    };
    const included = [{ type: "territories", id: "GBR", attributes: { currency: "GBP" } }, {
      type: "subscriptionPricePoints",
      id: "point-gb-current",
      attributes: { customerPrice: "99.99", proceeds: "69.99", proceedsYear2: "84.99" },
      relationships: { territory: { data: { type: "territories", id: "GBR" } } },
    }, {
      type: "subscriptionPricePoints",
      id: "point-gb-lower",
      attributes: { customerPrice: "94.99", proceeds: "66.49", proceedsYear2: "80.74" },
      relationships: { territory: { data: { type: "territories", id: "GBR" } } },
    }];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/subscriptions/subscription-yearly/prices" && init?.method === "GET") {
        return json(page(scheduled ? [currentPrice, scheduledPrice] : [currentPrice], { included }));
      }
      if (url.pathname === "/v1/subscriptionPrices" && init?.method === "POST") {
        scheduled = true;
        return json({ data: { type: "subscriptionPrices", id: "price-gb-created" } }, 201);
      }
      if (url.pathname === "/v1/subscriptionPrices/price-gb-created" && init?.method === "DELETE") {
        removedId = "price-gb-created";
        scheduled = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    let caught: unknown;
    try {
      await provider.applySubscriptionPriceChanges({
        subscriptionId: "subscription-yearly",
        planType: "UPFRONT",
        startDate: "2026-09-15",
        expected: [{
          id: "price-gb-current",
          territory: "GBR",
          currency: "GBP",
          customerPrice: "99.99",
          proceeds: "69.99",
          proceedsYear2: "84.99",
          pricePointId: "point-gb-current",
          startDate: null,
          preserved: false,
          planType: "UPFRONT",
        }],
        changes: [{
          territory: "GBR",
          currency: "GBP",
          pricePointId: "point-gb-lower",
          customerPrice: "94.99",
          preserveCurrentPrice: false,
        }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("could not verify that the original subscription price schedule was restored");
    expect(removedId).toBe("price-gb-created");
    expect(scheduled).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it("requires manual review when an indeterminate Apple write cannot be rolled back exactly", async () => {
    let scheduled = false;
    const currentPrice = {
      type: "subscriptionPrices",
      id: "price-ca-current",
      attributes: { startDate: null, preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "CAN" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-ca-current" } },
      },
    };
    const scheduledPrice = {
      type: "subscriptionPrices",
      id: "price-ca-created",
      attributes: { startDate: "2026-09-15", preserved: false, planType: "UPFRONT" },
      relationships: {
        territory: { data: { type: "territories", id: "CAN" } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "point-ca-lower" } },
      },
    };
    const included = [{ type: "territories", id: "CAN", attributes: { currency: "CAD" } }, {
      type: "subscriptionPricePoints",
      id: "point-ca-current",
      attributes: { customerPrice: "159.99", proceeds: "111.99", proceedsYear2: "135.99" },
      relationships: { territory: { data: { type: "territories", id: "CAN" } } },
    }, {
      type: "subscriptionPricePoints",
      id: "point-ca-lower",
      attributes: { customerPrice: "149.99", proceeds: "104.99", proceedsYear2: "127.49" },
      relationships: { territory: { data: { type: "territories", id: "CAN" } } },
    }];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/subscriptions/subscription-yearly/prices" && init?.method === "GET") {
        return json(page(scheduled ? [currentPrice, scheduledPrice] : [currentPrice], { included }));
      }
      if (url.pathname === "/v1/subscriptionPrices" && init?.method === "POST") {
        scheduled = true;
        return json({ data: { type: "subscriptionPrices", id: "price-ca-created" } }, 201);
      }
      if (url.pathname === "/v1/subscriptionPrices/price-ca-created" && init?.method === "DELETE") {
        return json({ errors: [{ status: "500", title: "Delete failed", detail: "Schedule remained." }] }, 500);
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.applySubscriptionPriceChanges({
      subscriptionId: "subscription-yearly",
      planType: "UPFRONT",
      startDate: "2026-09-15",
      expected: [{
        id: "price-ca-current",
        territory: "CAN",
        currency: "CAD",
        customerPrice: "159.99",
        proceeds: "111.99",
        proceedsYear2: "135.99",
        pricePointId: "point-ca-current",
        startDate: null,
        preserved: false,
        planType: "UPFRONT",
      }],
      changes: [{
        territory: "CAN",
        currency: "CAD",
        pricePointId: "point-ca-lower",
        customerPrice: "149.99",
        preserveCurrentPrice: false,
      }],
    })).rejects.toThrow("could not verify that the original subscription price schedule was restored; review App Store Connect before retrying");
    expect(scheduled).toBe(true);
  });

  it("signs short-lived Apple JWTs and follows first-party pagination", async () => {
    const authorizations: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization) authorizations.push(authorization);
      if (url.searchParams.get("limit") === "1") return json(page([app("one", "One")]));
      if (url.searchParams.get("cursor") === "second") return json(page([app("two", "Two")]));
      return json(page(
        [app("one", "One")],
        { next: "https://api.appstoreconnect.apple.com/v1/apps?cursor=second" },
      ));
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.getStatus()).resolves.toMatchObject({
      connected: true,
      provider: "app-store-connect-api",
      profile: "Release key",
    });
    await expect(provider.listApps({ limit: 2 })).resolves.toEqual([
      { id: "one", name: "One", bundleId: "com.example.one", platforms: [] },
      { id: "two", name: "Two", bundleId: "com.example.two", platforms: [] },
    ]);

    const token = authorizations[0]?.replace(/^Bearer /, "");
    expect(token).toBeTruthy();
    const [encodedHeader, encodedPayload, encodedSignature] = token!.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toEqual({ alg: "ES256", kid: credentials.keyId, typ: "JWT" });
    const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString()) as Record<string, number | string>;
    expect(payload).toMatchObject({ iss: credentials.issuerId, aud: "appstoreconnect-v1" });
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(605);
    expect(Buffer.from(encodedSignature!, "base64url")).toHaveLength(64);
    expect(new Set(authorizations).size).toBe(1);
  });

  it("maps customer reviews, included responses, filters, and opaque paging cursors", async () => {
    let requestedUrl: URL | null = null;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname !== "/v1/apps/app-1/customerReviews" || init?.method !== "GET") {
        throw new Error(`Unexpected request: ${init?.method} ${url}`);
      }
      requestedUrl = url;
      return json({
        data: [{
          type: "customerReviews",
          id: "review-1",
          attributes: {
            rating: 2,
            title: "Sync needs attention",
            body: "The latest edits took too long to appear.",
            reviewerNickname: "CarefulWriter",
            createdDate: "2026-08-20T08:15:00-07:00",
            territory: "USA",
          },
          relationships: {
            response: { data: { type: "customerReviewResponses", id: "response-1" } },
          },
        }],
        included: [{
          type: "customerReviewResponses",
          id: "response-1",
          attributes: {
            responseBody: "We are investigating the sync delay.",
            lastModifiedDate: "2026-08-20T18:00:00Z",
            state: "PENDING_PUBLISH",
          },
          relationships: {
            review: { data: { type: "customerReviews", id: "review-1" } },
          },
        }],
        links: {
          self: url.toString(),
          next: "https://api.appstoreconnect.apple.com/v1/apps/app-1/customerReviews?cursor=AQ.secret&limit=1&filter%5Brating%5D=2",
        },
        meta: { paging: { total: 14, limit: 1 } },
      });
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.listCustomerReviews("app-1", {
      limit: 1,
      cursor: "AQ.first",
      ratings: [2, 5],
      territories: ["USA", "GBR"],
      sort: "rating",
      publishedResponse: false,
    })).resolves.toEqual({
      reviews: [{
        id: "review-1",
        appId: "app-1",
        rating: 2,
        title: "Sync needs attention",
        body: "The latest edits took too long to appear.",
        reviewerNickname: "CarefulWriter",
        createdAt: "2026-08-20T08:15:00-07:00",
        territory: "USA",
        response: {
          id: "response-1",
          reviewId: "review-1",
          responseBody: "We are investigating the sync delay.",
          lastModifiedAt: "2026-08-20T18:00:00Z",
          state: "PENDING_PUBLISH",
        },
      }],
      total: 14,
      nextCursor: "AQ.secret",
    });

    expect(requestedUrl).not.toBeNull();
    expect(requestedUrl!.searchParams.get("limit")).toBe("1");
    expect(requestedUrl!.searchParams.get("cursor")).toBe("AQ.first");
    expect(requestedUrl!.searchParams.get("filter[rating]")).toBe("2,5");
    expect(requestedUrl!.searchParams.get("filter[territory]")).toBe("USA,GBR");
    expect(requestedUrl!.searchParams.get("exists[publishedResponse]")).toBe("false");
    expect(requestedUrl!.searchParams.get("sort")).toBe("rating");
    expect(requestedUrl!.searchParams.get("include")).toBe("response");
    expect(requestedUrl!.searchParams.get("fields[customerReviews]")).toBe(
      "rating,title,body,reviewerNickname,createdDate,territory,response",
    );
    expect(requestedUrl!.searchParams.get("fields[customerReviewResponses]")).toBe(
      "responseBody,lastModifiedDate,state,review",
    );
  });

  it("reads one customer review and fails closed when linked response data is omitted", async () => {
    let omitIncluded = false;
    const review = {
      type: "customerReviews",
      id: "review-2",
      attributes: {
        rating: 5,
        title: "Excellent",
        body: "Fast and focused.",
        reviewerNickname: "OrbitFan",
        createdDate: "2026-08-19T12:00:00Z",
        territory: "GBR",
      },
      relationships: {
        response: { data: { type: "customerReviewResponses", id: "response-2" } },
      },
    };
    const included = [{
      type: "customerReviewResponses",
      id: "response-2",
      attributes: {
        responseBody: "Thank you!",
        lastModifiedDate: null,
        state: "PUBLISHED",
      },
    }];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname !== "/v1/customerReviews/review-2" || init?.method !== "GET") {
        throw new Error(`Unexpected request: ${init?.method} ${url}`);
      }
      expect(url.searchParams.get("include")).toBe("response");
      return json({ data: review, ...(omitIncluded ? {} : { included }), links: { self: url.toString() } });
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.getCustomerReview("app-1", "review-2")).resolves.toEqual(expect.objectContaining({
      id: "review-2",
      appId: "app-1",
      response: expect.objectContaining({ id: "response-2", reviewId: "review-2", lastModifiedAt: null }),
    }));

    omitIncluded = true;
    await expect(provider.getCustomerReview("app-1", "review-2")).rejects.toThrow(
      "omitted included response data for customer review review-2",
    );
  });

  it("posts the exact customer review response document once and verifies its review relationship", async () => {
    let requestBody: unknown;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname !== "/v1/customerReviewResponses" || init?.method !== "POST") {
        throw new Error(`Unexpected request: ${init?.method} ${url}`);
      }
      requestBody = JSON.parse(String(init.body));
      return json({
        data: {
          type: "customerReviewResponses",
          id: "response-new",
          attributes: {
            responseBody: "Thanks for the thoughtful report.",
            lastModifiedDate: "2026-08-21T12:00:00Z",
            state: "PENDING_PUBLISH",
          },
          relationships: {
            review: { data: { type: "customerReviews", id: "review-9" } },
          },
        },
        links: { self: "https://api.appstoreconnect.apple.com/v1/customerReviewResponses/response-new" },
      }, 201);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.upsertCustomerReviewResponse(
      "review-9",
      "Thanks for the thoughtful report.",
    )).resolves.toEqual({
      id: "response-new",
      reviewId: "review-9",
      responseBody: "Thanks for the thoughtful report.",
      lastModifiedAt: "2026-08-21T12:00:00Z",
      state: "PENDING_PUBLISH",
    });
    expect(requestBody).toEqual({
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody: "Thanks for the thoughtful report." },
        relationships: {
          review: { data: { type: "customerReviews", id: "review-9" } },
        },
      },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry customer review response writes", async () => {
    const mockFetch = vi.fn(async () => json({
      errors: [{ status: "500", code: "UNAVAILABLE", detail: "Try later." }],
    }, 500)) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.upsertCustomerReviewResponse("review-10", "We are looking into this."))
      .rejects.toMatchObject({ status: 500, code: "UNAVAILABLE" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a customer review response linked to another review", async () => {
    const mockFetch = vi.fn(async () => json({
      data: {
        type: "customerReviewResponses",
        id: "response-wrong",
        attributes: {
          responseBody: "Wrong review.",
          lastModifiedDate: null,
          state: "PENDING_PUBLISH",
        },
        relationships: {
          review: { data: { type: "customerReviews", id: "review-other" } },
        },
      },
      links: { self: "https://api.appstoreconnect.apple.com/v1/customerReviewResponses/response-wrong" },
    }, 201)) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.upsertCustomerReviewResponse("review-expected", "Reply."))
      .rejects.toThrow("without the expected review relationship");
  });

  it("maps builds and groups from Apple's JSON:API relationships and writes group access directly", async () => {
    let assignmentBody: unknown;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/builds" && init?.method === "GET") {
        return json(page([{
          type: "builds",
          id: "build-44",
          attributes: {
            version: "44",
            uploadedDate: "2026-08-16T10:00:00Z",
            processingState: "VALID",
            expired: false,
            computedMinMacOsVersion: null,
            computedMinVisionOsVersion: null,
            lsMinimumSystemVersion: "15.0",
          },
          relationships: {
            preReleaseVersion: { data: { type: "preReleaseVersions", id: "pre-310" } },
            betaGroups: { data: [{ type: "betaGroups", id: "group-team" }] },
          },
        }], { included: [
          { type: "preReleaseVersions", id: "pre-310", attributes: { version: "3.1.0", platform: "MAC_OS" } },
          { type: "betaGroups", id: "group-team", attributes: { name: "Team", isInternalGroup: true } },
        ] }));
      }
      if (url.pathname === "/v1/builds/build-44/relationships/betaGroups" && init?.method === "POST") {
        assignmentBody = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.listBuilds("app-1")).resolves.toEqual([expect.objectContaining({
      id: "build-44",
      version: "3.1.0",
      buildNumber: "44",
      platform: "MAC_OS",
      minimumOs: "15.0",
      testingStatus: "Internal",
      groups: [{ id: "group-team", name: "Team", testerCount: null, internal: true }],
    })]);
    await provider.addBuildToGroup({ appId: "app-1", buildId: "build-44", groupId: "group-qa" });
    expect(assignmentBody).toEqual({ data: [{ type: "betaGroups", id: "group-qa" }] });
  });

  it("clears metadata through Apple's nullable fields and verifies the saved value", async () => {
    let promotionalText: string | null = "Old promotion";
    let description = "Description";
    let supportUrl = "https://example.com/support";
    let patchBody: unknown;
    const localizationPage = () => page([{
      type: "appStoreVersionLocalizations",
      id: "loc-en",
      attributes: {
        locale: "en-US",
        description,
        keywords: "notes,writing",
        promotionalText,
        supportUrl,
        whatsNew: "Faster sync.",
      },
    }]);
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/appStoreVersionLocalizations") && init?.method === "GET") return json(localizationPage());
      if (url.pathname === "/v1/appStoreVersionLocalizations/loc-en" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        promotionalText = null;
        description = "A calmer writing space.";
        supportUrl = "https://example.com/help";
        return json({ data: localizationPage().data[0] });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await provider.applyVersionLocalizationPatches(
      "version-1",
      [{
        locale: "en-US",
        description: "A calmer writing space.",
        promotionalText: "",
        supportUrl: "https://example.com/help",
      }],
      [{
        id: "loc-en",
        locale: "en-US",
        description: "Description",
        whatsNew: "Faster sync.",
        promotionalText: "Old promotion",
        keywords: "notes,writing",
        marketingUrl: "",
        supportUrl: "https://example.com/support",
      }],
    );
    expect(patchBody).toEqual({
      data: {
        type: "appStoreVersionLocalizations",
        id: "loc-en",
        attributes: {
          description: "A calmer writing space.",
          promotionalText: null,
          supportUrl: "https://example.com/help",
        },
      },
    });
  });

  it("uses Apple's reserve-upload-commit protocol for screenshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-provider-"));
    temporaryDirectories.push(root);
    const uploadId = "11111111-2222-4333-8444-555555555555";
    const fileName = "screen.png";
    const directory = join(root, uploadId);
    const body = Buffer.from("fixture image bytes");
    await mkdir(directory);
    await writeFile(join(directory, fileName), body);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const md5 = createHash("md5").update(body).digest("hex");
    let uploadedChunk: Uint8Array | null = null;
    let committed = false;
    let relatedIds: unknown;
    const screenshotResource = () => ({
      type: "appScreenshots",
      id: "screenshot-new",
      attributes: {
        fileName,
        fileSize: body.length,
        sourceFileChecksum: committed ? md5 : undefined,
        uploadOperations: committed ? [] : [{
          method: "PUT",
          url: "https://uploads.example.com/part",
          offset: 0,
          length: body.length,
          requestHeaders: [{ name: "content-type", value: "application/octet-stream" }],
        }],
        assetDeliveryState: committed ? { state: "COMPLETE" } : { state: "AWAITING_UPLOAD" },
        ...(committed ? { imageAsset: { templateUrl: "https://images.example.com/{w}x{h}{c}.{f}", width: 1290, height: 2796 } } : {}),
      },
    });
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "uploads.example.com") {
        uploadedChunk = new Uint8Array(init?.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      if (url.pathname.endsWith("/appScreenshotSets") && init?.method === "GET") {
        return json(page([{ type: "appScreenshotSets", id: "set-1", attributes: { screenshotDisplayType: "APP_IPHONE_69" } }]));
      }
      if (url.pathname === "/v1/appScreenshotSets/set-1/appScreenshots" && init?.method === "GET") {
        return json(page(committed ? [screenshotResource()] : []));
      }
      if (url.pathname === "/v1/appScreenshots" && init?.method === "POST") return json({ data: screenshotResource() }, 201);
      if (url.pathname === "/v1/appScreenshots/screenshot-new" && init?.method === "PATCH") {
        committed = true;
        return json({ data: screenshotResource() });
      }
      if (url.pathname === "/v1/appScreenshots/screenshot-new" && init?.method === "GET") return json({ data: screenshotResource() });
      if (url.pathname === "/v1/appScreenshotSets/set-1/relationships/appScreenshots" && init?.method === "PATCH") {
        relatedIds = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch, uploadDirectory: root });

    await provider.applyScreenshotChanges({
      localizationId: "loc-en",
      locale: "en-US",
      displayType: "APP_IPHONE_69",
      uploads: [{
        uploadId,
        displayType: "APP_IPHONE_69",
        fileName,
        mediaType: "image/png",
        fileSize: body.length,
        width: 1290,
        height: 2796,
        checksum: sha256,
        hasAlpha: false,
      }],
      deleteIds: [],
      expected: [],
    });

    expect(Buffer.from(uploadedChunk!)).toEqual(body);
    expect(relatedIds).toEqual({ data: [{ type: "appScreenshots", id: "screenshot-new" }] });
  });

  it("loads older screenshots when Apple omits optional asset attributes", async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/appScreenshotSets") && init?.method === "GET") {
        return json(page([{
          type: "appScreenshotSets",
          id: "legacy-set",
          attributes: { screenshotDisplayType: "APP_IPHONE_69" },
        }]));
      }
      if (url.pathname === "/v1/appScreenshotSets/legacy-set/appScreenshots" && init?.method === "GET") {
        return json(page([{
          type: "appScreenshots",
          id: "legacy-screenshot",
          attributes: {
            fileName: "legacy.png",
            fileSize: null,
            uploadOperations: null,
            imageAsset: {
              templateUrl: "https://images.apple.test/{w}x{h}{c}.{f}",
              width: 1290,
              height: 2796,
            },
            assetDeliveryState: { state: "COMPLETE" },
          },
        }, {
          type: "appScreenshots",
          id: "legacy-screenshot-without-attributes",
        }]));
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.listScreenshots("loc-en", "en-US", "APP_IPHONE_69")).resolves.toEqual([
      expect.objectContaining({
        id: "legacy-screenshot",
        fileName: "legacy.png",
        fileSize: 0,
        width: 1290,
        height: 2796,
        state: "COMPLETE",
        imageUrl: "https://images.apple.test/332x720bb.jpg",
        fullImageUrl: "https://images.apple.test/1290x2796bb.jpg",
      }),
      expect.objectContaining({
        id: "legacy-screenshot-without-attributes",
        fileName: "screenshot-2",
        fileSize: 0,
        state: "COMPLETE",
      }),
    ]);
  });

  it("attaches a build and creates Apple's review submission resources in order", async () => {
    const writes: Array<{ method: string; path: string; body: unknown }> = [];
    const version = {
      type: "appStoreVersions",
      id: "version-1",
      attributes: {
        platform: "IOS",
        versionString: "2.6.0",
        appVersionState: "PREPARE_FOR_SUBMISSION",
      },
      relationships: { app: { data: { type: "apps", id: "app-1" } } },
    };
    const submission = (state: string, submittedDate?: string) => ({
      type: "reviewSubmissions",
      id: "submission-1",
      attributes: { platform: "IOS", state, ...(submittedDate ? { submittedDate } : {}) },
      relationships: { appStoreVersionForReview: { data: { type: "appStoreVersions", id: "version-1" } } },
    });
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.pathname === "/v1/appStoreVersions/version-1" && method === "GET") return json({ data: version });
      if (url.pathname.endsWith("/relationships/build") && method === "GET") return json({ data: null, links: {} });
      if (url.pathname.endsWith("/relationships/build") && method === "PATCH") return new Response(null, { status: 204 });
      if (url.pathname === "/v1/reviewSubmissions" && method === "GET") return json(page([]));
      if (url.pathname === "/v1/reviewSubmissions" && method === "POST") return json({ data: submission("READY_FOR_REVIEW") }, 201);
      if (url.pathname === "/v1/reviewSubmissionItems" && method === "POST") {
        return json({ data: { type: "reviewSubmissionItems", id: "item-1", attributes: { state: "READY_FOR_REVIEW" } } }, 201);
      }
      if (url.pathname === "/v1/reviewSubmissions/submission-1" && method === "PATCH") {
        return json({ data: submission("WAITING_FOR_REVIEW", "2026-08-16T12:00:00Z") });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.submitVersion({ appId: "app-1", versionId: "version-1", buildId: "build-1" })).resolves.toEqual({
      appId: "app-1",
      versionId: "version-1",
      versionString: "2.6.0",
      platform: "IOS",
      buildId: "build-1",
      submissionId: "submission-1",
      submittedAt: "2026-08-16T12:00:00Z",
      alreadySubmitted: false,
      attached: true,
      alreadyAttached: false,
    });
    expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "PATCH /v1/appStoreVersions/version-1/relationships/build",
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/submission-1",
    ]);
  });
});
