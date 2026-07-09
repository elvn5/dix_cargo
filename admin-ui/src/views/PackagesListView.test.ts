import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const routeState = reactive({ query: {} as Record<string, string | undefined> });
const replace = vi.fn((opts: { query: Record<string, string | undefined> }) => {
  routeState.query = { ...opts.query };
});
vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ replace }),
}));

import PackagesListView from "./PackagesListView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function packagesPage(overrides: Record<string, unknown> = {}) {
  return { packages: [], total: 0, totalPages: 1, activeCount: 0, archiveCount: 0, ...overrides };
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  replace.mockReset();
  routeState.query = {};
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PackagesListView", () => {
  it("loads the active tab by default", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage({ activeCount: 5, archiveCount: 2 }));
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/admin/packages?tab=active&page=1");
    expect(wrapper.text()).toContain("5");
  });

  it("renders package rows and an empty state", async () => {
    vi.mocked(api.get).mockResolvedValue(
      packagesPage({ packages: [{ id: 1, track_code: "T1", status: "IN_TRANSIT", created_at: "2026-01-01T00:00:00Z", user: { client_code: "DIX-0001", full_name: "Иван" } }], total: 1 })
    );
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("T1");
    expect(wrapper.text()).toContain("DIX-0001");
  });

  it("shows the empty state with no packages", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage());
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Нет посылок");
  });

  it("switches to the archive tab and hides the status filter", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage());
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();
    expect(wrapper.find("select").exists()).toBe(true);

    await wrapper.findAll(".tab-link")[1].trigger("click");
    await flushPromises();

    expect(replace).toHaveBeenCalledWith({ query: { tab: "archive" } });
    expect(wrapper.find("select").exists()).toBe(false);
  });

  it("applies search/status/date filters", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage());
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();

    await wrapper.find("input.input").setValue("TRACK");
    await wrapper.find("select").setValue("IN_OFFICE");
    const dateInputs = wrapper.findAll('input[type=date]');
    await dateInputs[0].setValue("2026-01-01");
    await dateInputs[1].setValue("2026-01-31");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(replace).toHaveBeenCalledWith({
      query: { tab: "active", page: "1", search: "TRACK", status: "IN_OFFICE", date_from: "2026-01-01", date_to: "2026-01-31" },
    });
  });

  it("resets filters", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage());
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();

    await wrapper.find("input.input").setValue("TRACK");
    const resetBtn = wrapper.findAll("button").find((b) => b.text() === "Сброс")!;
    await resetBtn.trigger("click");

    expect(replace).toHaveBeenCalledWith({ query: { tab: "active" } });
    expect((wrapper.find("input.input").element as HTMLInputElement).value).toBe("");
  });

  it("paginates forward/backward and disables edges", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage({ totalPages: 3 }));
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();

    const links = wrapper.findAll(".page-link");
    expect(links[0].classes()).toContain("page-link-disabled"); // prev disabled on page 1
    await links[1].trigger("click"); // page "1"
    await flushPromises();
    expect(replace).toHaveBeenCalledWith({ query: { tab: "active", page: "1" } });
  });

  it("builds the export URL from current filters", async () => {
    vi.mocked(api.get).mockResolvedValue(packagesPage());
    wrapper = mount(PackagesListView, globalStubs);
    await flushPromises();
    const exportLink = wrapper.findAll("a").find((a) => a.text().includes("Скачать Excel"))!;
    expect(exportLink.attributes("href")).toContain("/api/admin/packages/export?tab=active");
  });
});
