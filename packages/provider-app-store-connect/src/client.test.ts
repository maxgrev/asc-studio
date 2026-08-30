import { generateKeyPairSync } from "node:crypto";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStoreConnectClient } from "./client.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials = {
  profileName: "Retry key",
  issuerId: "11111111-2222-3333-4444-555555555555",
  keyId: "ABC123DEFG",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  authBackend: "Test memory",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("AppStoreConnectClient transient transport handling", () => {
  it("retries an idempotent GET after a transient network failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const client = new AppStoreConnectClient({
      credentials: async () => credentials,
      fetch: fetchMock,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    const request = client.request("GET", "/v1/test", z.object({ ok: z.boolean() }));
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a write after a transport failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket reset")) as unknown as typeof fetch;
    const client = new AppStoreConnectClient({ credentials: async () => credentials, fetch: fetchMock });

    await expect(client.request("POST", "/v1/test", z.object({ ok: z.boolean() }), {
      body: { value: true },
    })).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
