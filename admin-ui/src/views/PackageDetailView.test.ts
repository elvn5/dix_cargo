import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const routeState = { params: { id: "1" }, query: {} as Record<string, string> };
const push = vi.fn();
const replace = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push, replace }),
}));

import PackageDetailView from "./PackageDetailView.vue";
import { api, ApiError } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function pkgDetail(overrides: Record<string, unknown> = {}) {
  return {
    package: {
      id: 1, track_code: "T1", status: "IN_TRANSIT", weight: null, price: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      user: { client_code: "DIX-0001", full_name: "Иван" },
    },
    tariff: 0,
    ...overrides,
  };
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.delete).mockReset();
  push.mockReset();
  replace.mockReset();
  routeState.params = { id: "1" };
  routeState.query = {};
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PackageDetailView", () => {
  it("shows a loading state then the form", async () => {
    vi.mocked(api.get).mockResolvedValue(pkgDetail());
    wrapper = mount(PackageDetailView, globalStubs);
    expect(wrapper.text()).toContain("Загрузка");
    await flushPromises();
    expect((wrapper.find("input.font-mono").element as HTMLInputElement).value).toBe("T1");
  });

  it("redirects to /packages on a 404", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, "not_found"));
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();
    expect(replace).toHaveBeenCalledWith("/packages");
  });

  it("shows the saved banner from the query string", async () => {
    routeState.query = { saved: "1" };
    vi.mocked(api.get).mockResolvedValue(pkgDetail());
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Изменения сохранены");
  });

  it("shows weight/price placeholders as em-dash when absent", async () => {
    vi.mocked(api.get).mockResolvedValue(pkgDetail());
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();
    const dds = wrapper.findAll("dd");
    expect(dds[1].text()).toBe("—");
    expect(dds[2].text()).toBe("—");
  });

  it("shows formatted weight and price when present", async () => {
    vi.mocked(api.get).mockResolvedValue(pkgDetail({ package: { ...pkgDetail().package, weight: 2.5, price: 1500 } }));
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("2.5 кг");
    expect(wrapper.text()).toContain("1 500 сом");
  });

  it("auto-calculates price from weight using the tariff", async () => {
    vi.mocked(api.get).mockResolvedValue(pkgDetail({ tariff: 100 }));
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();
    await wrapper.findAll('input[placeholder="0.00"]')[0].setValue("2");
    const priceInput = wrapper.findAll('input[placeholder="0.00"]')[1];
    expect((priceInput.element as HTMLInputElement).value).toBe("200.00");
  });

  it("saves changes and reloads", async () => {
    vi.mocked(api.get).mockResolvedValue(pkgDetail());
    vi.mocked(api.put).mockResolvedValue({ package: {} });
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith("/admin/packages/1", { track_code: "T1", status: "IN_TRANSIT", weight: "", price: "" });
    expect(replace).toHaveBeenCalledWith({ query: { saved: "1" } });
  });

  it("deletes after confirmation and navigates to the list", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue(pkgDetail());
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();

    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith("/admin/packages/1");
    expect(push).toHaveBeenCalledWith("/packages");
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.get).mockResolvedValue(pkgDetail());
    wrapper = mount(PackageDetailView, globalStubs);
    await flushPromises();
    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
