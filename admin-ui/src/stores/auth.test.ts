import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { useAuthStore } from "./auth";
import { api } from "../api/client";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe("auth store", () => {
  it("starts unauthenticated and unchecked", () => {
    const store = useAuthStore();
    expect(store.authenticated).toBe(false);
    expect(store.checked).toBe(false);
    expect(store.branch).toBe("bishkek");
  });

  it("fetchMe populates state from /me", async () => {
    vi.mocked(api.get).mockResolvedValue({
      authenticated: true,
      branch: "kant",
      branches: [{ key: "bishkek", label: "г. Бишкек" }, { key: "kant", label: "г. Кант" }],
      appVersion: "1.2.3",
      isStaging: true,
    });

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.authenticated).toBe(true);
    expect(store.branch).toBe("kant");
    expect(store.branches).toHaveLength(2);
    expect(store.appVersion).toBe("1.2.3");
    expect(store.isStaging).toBe(true);
    expect(store.checked).toBe(true);
  });

  it("fetchMe marks unauthenticated on failure but still sets checked", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network down"));

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.authenticated).toBe(false);
    expect(store.checked).toBe(true);
  });

  it("login posts credentials then refreshes /me", async () => {
    vi.mocked(api.post).mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValue({
      authenticated: true, branch: "bishkek", branches: [], appVersion: "dev", isStaging: false,
    });

    const store = useAuthStore();
    await store.login("admin@dixcargo.com", "changeme", true);

    expect(api.post).toHaveBeenCalledWith("/admin/login", { email: "admin@dixcargo.com", password: "changeme", remember: true });
    expect(store.authenticated).toBe(true);
  });

  it("logout clears authenticated state", async () => {
    vi.mocked(api.post).mockResolvedValue(undefined);
    const store = useAuthStore();
    store.authenticated = true;

    await store.logout();

    expect(api.post).toHaveBeenCalledWith("/admin/logout");
    expect(store.authenticated).toBe(false);
  });

  it("setBranch persists the branch server-side then updates local state", async () => {
    vi.mocked(api.post).mockResolvedValue(undefined);
    const store = useAuthStore();

    await store.setBranch("kant");

    expect(api.post).toHaveBeenCalledWith("/admin/branch", { branch: "kant" });
    expect(store.branch).toBe("kant");
  });
});
