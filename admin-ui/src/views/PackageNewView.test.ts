import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import PackageNewView from "./PackageNewView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function meta(overrides: Record<string, unknown> = {}) {
  return { tariff: 100, users: [{ id: 1, client_code: "DIX-0001", full_name: "Иван" }], ...overrides };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue(meta());
  vi.mocked(api.post).mockReset();
  push.mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PackageNewView", () => {
  it("preselects the first user and shows the tariff", async () => {
    const wrapper = mount(PackageNewView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("100 сом/кг");
    expect((wrapper.find("select").element as HTMLSelectElement).value).toBe("1");
  });

  it("auto-calculates price from weight using the tariff", async () => {
    const wrapper = mount(PackageNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="0.00"]').setValue("2.5");
    const priceInput = wrapper.findAll('input[placeholder="0.00"]')[1];
    expect((priceInput.element as HTMLInputElement).value).toBe("250.00");
  });

  it("prevents Enter in the track-code field from submitting (scanner guard)", async () => {
    const wrapper = mount(PackageNewView, globalStubs);
    await flushPromises();
    const trackInput = wrapper.find('input[placeholder="RU123456789CN"]');
    const evt = { key: "Enter", preventDefault: vi.fn() };
    await trackInput.trigger("keydown", evt);
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it("submits the package and navigates to the list", async () => {
    vi.mocked(api.post).mockResolvedValue({ package: { id: 1 } });
    const wrapper = mount(PackageNewView, globalStubs);
    await flushPromises();

    await wrapper.find('input[placeholder="RU123456789CN"]').setValue("RU123");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/packages", {
      user_id: 1, track_code: "RU123", status: "IN_TRANSIT", weight: undefined, price: undefined,
    });
    expect(push).toHaveBeenCalledWith("/packages");
  });

  it("lets the admin change the client and status selects and edit the price directly", async () => {
    vi.mocked(api.get).mockResolvedValue(meta({ users: [
      { id: 1, client_code: "DIX-0001", full_name: "Иван" },
      { id: 2, client_code: "DIX-0002", full_name: "Пётр" },
    ] }));
    vi.mocked(api.post).mockResolvedValue({ package: { id: 1 } });
    const wrapper = mount(PackageNewView, globalStubs);
    await flushPromises();

    await wrapper.find("select").setValue("2");
    await wrapper.findAll("select")[1].setValue("DELIVERED");
    await wrapper.find('input[placeholder="RU123456789CN"]').setValue("RU999");
    await wrapper.findAll('input[placeholder="0.00"]')[1].setValue("321.50");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/packages", {
      user_id: 2, track_code: "RU999", status: "DELIVERED", weight: undefined, price: 321.5,
    });
  });
});
