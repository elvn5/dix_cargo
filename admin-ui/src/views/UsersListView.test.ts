import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), delete: vi.fn() } };
});

const routeState = reactive({ query: {} as Record<string, string | undefined> });
const replace = vi.fn((opts: { query: Record<string, string | undefined> }) => {
  routeState.query = { ...opts.query };
});
vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ replace }),
}));

import UsersListView from "./UsersListView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function usersPage(overrides: Partial<{ users: any[]; total: number; pages: number }> = {}) {
  return { users: [], total: 0, pages: 1, ...overrides };
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.delete).mockReset();
  replace.mockReset();
  routeState.query = {};
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("UsersListView", () => {
  it("loads and renders users on mount", async () => {
    vi.mocked(api.get).mockResolvedValue(
      usersPage({ users: [{ id: 1, client_code: "DIX-0001", full_name: "Иван", phone: "500100500", created_at: "2026-01-01T00:00:00Z", packages_count: 4 }], total: 1 })
    );
    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("DIX-0001");
    expect(wrapper.text()).toContain("4");
    expect(api.get).toHaveBeenCalledWith("/admin/users?page=1&q=");
  });

  it("shows an empty state", async () => {
    vi.mocked(api.get).mockResolvedValue(usersPage());
    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Нет пользователей");
  });

  it("searching updates the query and reloads", async () => {
    vi.mocked(api.get).mockResolvedValue(usersPage());
    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();

    await wrapper.find("input").setValue("Иван");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(replace).toHaveBeenCalledWith({ query: { page: "1", q: "Иван" } });
    expect(api.get).toHaveBeenLastCalledWith("/admin/users?page=1&q=%D0%98%D0%B2%D0%B0%D0%BD");
  });

  it("shows a reset button once a query is entered, and resets it", async () => {
    vi.mocked(api.get).mockResolvedValue(usersPage());
    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();

    await wrapper.find("input").setValue("Иван");
    await wrapper.vm.$nextTick();
    const resetBtn = wrapper.findAll("button").find((b) => b.text() === "Сброс");
    expect(resetBtn).toBeTruthy();

    await resetBtn!.trigger("click");
    expect(replace).toHaveBeenCalledWith({ query: {} });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("");
  });

  it("paginates via page links", async () => {
    vi.mocked(api.get).mockResolvedValue(usersPage({ pages: 3 }));
    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();

    const pageLinks = wrapper.findAll(".page-link");
    expect(pageLinks).toHaveLength(3);
    await pageLinks[1].trigger("click");
    await flushPromises();

    expect(replace).toHaveBeenCalledWith({ query: { page: "2", q: undefined } });
  });

  it("deletes a user after confirmation and reloads the list", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue(
      usersPage({ users: [{ id: 1, client_code: "DIX-0001", full_name: "Иван", phone: "1", created_at: "2026-01-01T00:00:00Z" }], total: 1 })
    );
    vi.mocked(api.delete).mockResolvedValue({ ok: true });

    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();

    const deleteBtn = wrapper.find(".btn-outline-danger");
    await deleteBtn.trigger("click");
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith("/admin/users/1");
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.get).mockResolvedValue(
      usersPage({ users: [{ id: 1, client_code: "DIX-0001", full_name: "Иван", phone: "1", created_at: "2026-01-01T00:00:00Z" }], total: 1 })
    );

    wrapper = mount(UsersListView, globalStubs);
    await flushPromises();
    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();

    expect(api.delete).not.toHaveBeenCalled();
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
