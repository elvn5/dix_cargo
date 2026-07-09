import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const routeState = { query: {} as Record<string, string> };
const push = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push }),
}));

import LoginView from "./LoginView.vue";
import { api, ApiError } from "../api/client";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  push.mockReset();
  routeState.query = {};
});

describe("LoginView", () => {
  it("logs in and redirects to the dashboard by default", async () => {
    vi.mocked(api.post).mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValue({ authenticated: true, branch: "bishkek", branches: [], appVersion: "dev", isStaging: false });

    const wrapper = mount(LoginView);
    await wrapper.find("input[type=email]").setValue("admin@dixcargo.com");
    await wrapper.find("input[type=password]").setValue("changeme");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/login", { email: "admin@dixcargo.com", password: "changeme", remember: false });
    expect(push).toHaveBeenCalledWith("/");
  });

  it("redirects to the originally requested page after login", async () => {
    routeState.query = { redirect: "/users/5" };
    vi.mocked(api.post).mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValue({ authenticated: true, branch: "bishkek", branches: [], appVersion: "dev", isStaging: false });

    const wrapper = mount(LoginView);
    await wrapper.find("input[type=email]").setValue("a@b.com");
    await wrapper.find("input[type=password]").setValue("pw");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(push).toHaveBeenCalledWith("/users/5");
  });

  it("shows an auth error message on invalid credentials", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(401, "invalid_credentials"));

    const wrapper = mount(LoginView);
    await wrapper.find("input[type=email]").setValue("a@b.com");
    await wrapper.find("input[type=password]").setValue("wrong");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(wrapper.text()).toContain("Неверный email или пароль");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a generic network error for non-ApiError failures", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("offline"));

    const wrapper = mount(LoginView);
    await wrapper.find("input[type=email]").setValue("a@b.com");
    await wrapper.find("input[type=password]").setValue("pw");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(wrapper.text()).toContain("Ошибка сети");
  });

  it("toggles password visibility", async () => {
    const wrapper = mount(LoginView);
    const pwInput = wrapper.find("input[type=password], input[type=text]");
    expect(wrapper.find("input#remember").exists()).toBe(true);
    await wrapper.find("button[type=button]").trigger("click");
    expect(wrapper.find("input[type=text]").exists()).toBe(true);
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
