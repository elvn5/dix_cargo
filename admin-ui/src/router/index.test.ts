import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import router from "./index";
import { api } from "../api/client";

function meResponse(authenticated: boolean) {
  return { authenticated, branch: "bishkek" as const, branches: [], appVersion: "dev", isStaging: false };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(api.get).mockReset();
});

describe("router auth guard", () => {
  it("redirects unauthenticated users to /login with a redirect query", async () => {
    vi.mocked(api.get).mockResolvedValue(meResponse(false));
    await router.push("/users");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("login");
    expect(router.currentRoute.value.query.redirect).toBe("/users");
  });

  it("allows authenticated users through to protected routes", async () => {
    vi.mocked(api.get).mockResolvedValue(meResponse(true));
    await router.push("/users");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("users");
  });

  it("lets unauthenticated users reach /login directly", async () => {
    vi.mocked(api.get).mockResolvedValue(meResponse(false));
    await router.push("/login");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("redirects an already-authenticated user away from /login", async () => {
    vi.mocked(api.get).mockResolvedValue(meResponse(true));
    // A distinct query string avoids a same-route no-op if the router is already sitting on /login.
    await router.push({ path: "/login", query: { from: "test" } });
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("dashboard");
  });

  it("only calls /me once auth has been checked", async () => {
    vi.mocked(api.get).mockResolvedValue(meResponse(true));
    await router.push("/users");
    await router.isReady();
    await router.push("/settings");
    await router.isReady();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("redirects unknown paths to the dashboard", async () => {
    vi.mocked(api.get).mockResolvedValue(meResponse(true));
    await router.push("/nothing-here");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("dashboard");
  });
});
