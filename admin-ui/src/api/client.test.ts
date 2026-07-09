import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./client";

function fakeResponse(opts: { status?: number; ok?: boolean; contentType?: string; body?: unknown }) {
  const { status = 200, ok = status < 400, contentType = "application/json", body } = opts;
  return {
    status,
    ok,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("GET sends credentials and a JSON content-type header", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ body: { ok: true } }));
    const result = await api.get<{ ok: boolean }>("/admin/me");

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/me",
      expect.objectContaining({ credentials: "include", headers: { "Content-Type": "application/json" } })
    );
    expect(result).toEqual({ ok: true });
  });

  it("POST JSON-encodes a plain object body", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ body: { ok: true } }));
    await api.post("/admin/branch", { branch: "kant" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ branch: "kant" }));
  });

  it("POST defaults to an empty object body when omitted", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ body: { ok: true } }));
    await api.post("/admin/logout");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.body).toBe("{}");
  });

  it("POST sends FormData bodies as-is without a Content-Type header", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ body: { ok: true } }));
    const form = new FormData();
    form.append("file", "x");
    await api.post("/admin/packages/import", form);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.body).toBe(form);
    expect(init?.headers).toBeUndefined();
  });

  it("PUT JSON-encodes the body", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ body: { ok: true } }));
    await api.put("/admin/settings", { tariff_per_kg: "100" });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ tariff_per_kg: "100" }));
  });

  it("DELETE sends no body", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ body: { ok: true } }));
    await api.delete("/admin/users/1");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("DELETE");
  });

  it("throws a 401 ApiError without attempting to parse a body", async () => {
    const res = fakeResponse({ status: 401, ok: false });
    vi.mocked(fetch).mockResolvedValue(res);

    await expect(api.get("/admin/dashboard")).rejects.toMatchObject({ status: 401 });
    expect(res.json).not.toHaveBeenCalled();
  });

  it("throws an ApiError using the server's error message on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ status: 409, ok: false, body: { error: "duplicate_phone" } }));
    await expect(api.get("/admin/users")).rejects.toMatchObject({ status: 409, message: "duplicate_phone" });
  });

  it("falls back to a generic message when the error body has no message", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ status: 500, ok: false, contentType: "text/plain" }));
    await expect(api.get("/admin/users")).rejects.toMatchObject({ status: 500, message: "Ошибка запроса (500)" });
  });

  it("returns undefined for a non-JSON successful response", async () => {
    const result = await (async () => {
      vi.mocked(fetch).mockResolvedValue(fakeResponse({ status: 200, ok: true, contentType: "application/sql" }));
      return api.get("/admin/db-dump");
    })();
    expect(result).toBeUndefined();
  });

  it("ApiError carries its HTTP status", () => {
    const err = new ApiError(404, "not_found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("not_found");
    expect(err).toBeInstanceOf(Error);
  });
});
