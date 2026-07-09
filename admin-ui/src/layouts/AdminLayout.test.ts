import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import AdminLayout from "./AdminLayout.vue";
import { useAuthStore } from "../stores/auth";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset().mockResolvedValue(undefined);
  push.mockReset();
});

describe("AdminLayout", () => {
  it("renders the nav items and the app version", () => {
    const auth = useAuthStore();
    auth.appVersion = "1.2.3";
    const wrapper = mount(AdminLayout, globalStubs);
    expect(wrapper.text()).toContain("Пользователи");
    expect(wrapper.text()).toContain("Настройки бота");
    expect(wrapper.text()).toContain("v1.2.3");
  });

  it("shows the staging badge only when isStaging is true", () => {
    const auth = useAuthStore();
    auth.isStaging = true;
    const wrapper = mount(AdminLayout, globalStubs);
    expect(wrapper.text()).toContain("ТЕСТОВЫЙ");
  });

  it("does not show the staging badge in production", () => {
    const auth = useAuthStore();
    auth.isStaging = false;
    const wrapper = mount(AdminLayout, globalStubs);
    expect(wrapper.text()).not.toContain("ТЕСТОВЫЙ");
  });

  it("renders a disabled button for the active branch and an enabled one for the other", () => {
    const auth = useAuthStore();
    auth.branch = "bishkek";
    auth.branches = [{ key: "bishkek", label: "г. Бишкек" }, { key: "kant", label: "г. Кант" }];
    const wrapper = mount(AdminLayout, globalStubs);
    const buttons = wrapper.findAll(".btn-sm");
    const bishkekBtn = buttons.find((b) => b.text() === "г. Бишкек")!;
    const kantBtn = buttons.find((b) => b.text() === "г. Кант")!;
    expect((bishkekBtn.element as HTMLButtonElement).disabled).toBe(true);
    expect((kantBtn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("switching branches posts the change to the server", async () => {
    const auth = useAuthStore();
    auth.branch = "bishkek";
    auth.branches = [{ key: "bishkek", label: "г. Бишкек" }, { key: "kant", label: "г. Кант" }];
    const wrapper = mount(AdminLayout, globalStubs);

    const kantBtn = wrapper.findAll(".btn-sm").find((b) => b.text() === "г. Кант")!;
    await kantBtn.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/branch", { branch: "kant" });
    expect(auth.branch).toBe("kant");
  });

  it("logging out clears the session and redirects to /login", async () => {
    const wrapper = mount(AdminLayout, globalStubs);
    const logoutBtn = wrapper.findAll("button").find((b) => b.text().includes("Выйти"))!;
    await logoutBtn.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/logout");
    expect(push).toHaveBeenCalledWith({ name: "login" });
  });

  it("toggles the mobile sidebar", async () => {
    const wrapper = mount(AdminLayout, globalStubs);
    const nav = wrapper.find("nav");
    expect(nav.classes()).not.toContain("translate-x-0");

    await wrapper.find("header button").trigger("click");
    expect(nav.classes()).toContain("translate-x-0");

    // clicking the backdrop closes it again
    await wrapper.find(".fixed.inset-0").trigger("click");
    expect(nav.classes()).not.toContain("translate-x-0");
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
