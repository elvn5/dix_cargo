import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() } };
});

import DeliveryView from "./DeliveryView.vue";
import { api } from "../api/client";

let wrapper: VueWrapper | null = null;

const CLIENTS = {
  users: [
    { id: 7, client_code: "DIX-0007", full_name: "Иван Иванов", phone: "+996700000007", packages_count: 3 },
    { id: 8, client_code: "DIX-0008", full_name: "Пётр Петров", phone: "+996700000008", packages_count: 1 },
  ],
  total: 2,
};
const USER_7 = {
  user: { id: 7, client_code: "DIX-0007", full_name: "Иван Иванов" },
  tariff: 190,
  packages: [
    { id: 100, track_code: "RB100CN", status: "IN_OFFICE", weight: null, price: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
    { id: 101, track_code: "RB101CN", status: "IN_OFFICE", weight: 2, price: 380, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
    { id: 102, track_code: "RB102CN", status: "IN_TRANSIT", weight: null, price: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
    { id: 103, track_code: "RB103CN", status: "DELIVERED", weight: 1, price: 190, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
  ],
};

function mockApi() {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/admin/users?")) return Promise.resolve(CLIENTS as any);
    if (/^\/admin\/users\/\d+$/.test(path)) return Promise.resolve(USER_7 as any);
    return Promise.resolve({} as any);
  });
  vi.mocked(api.post).mockResolvedValue({ ok: true } as any);
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});
function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("DeliveryView", () => {
  it("loads the client list on mount and renders three windows", async () => {
    wrapper = mount(DeliveryView);
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining("/admin/users?"));
    expect(wrapper.findAll('[data-test="client-row"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="client-search"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="deliver-btn"]').exists()).toBe(true);
  });

  it("shows only IN_OFFICE packages of the selected client", async () => {
    wrapper = mount(DeliveryView);
    await flushPromises();
    await wrapper.findAll('[data-test="client-row"]')[0].trigger("click");
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/admin/users/7");
    // из 4 посылок только 2 в статусе IN_OFFICE
    expect(wrapper.findAll('[data-test="package-row"]')).toHaveLength(2);
  });

  it("moves checked packages into the third window", async () => {
    wrapper = mount(DeliveryView);
    await flushPromises();
    await wrapper.findAll('[data-test="client-row"]')[0].trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-test="deliver-row"]')).toHaveLength(0);
    const firstPkgCheckbox = wrapper.findAll('[data-test="package-row"]')[0].find("input[type=checkbox]");
    await firstPkgCheckbox.setValue(true);
    expect(wrapper.findAll('[data-test="deliver-row"]')).toHaveLength(1);
  });

  it("issues selected packages with weight/price via DELIVERED and reloads", async () => {
    wrapper = mount(DeliveryView);
    await flushPromises();
    await wrapper.findAll('[data-test="client-row"]')[0].trigger("click");
    await flushPromises();

    await wrapper.findAll('[data-test="package-row"]')[0].find("input[type=checkbox]").setValue(true);
    await wrapper.find('[data-test="deliver-weight"]').setValue("5");
    await flushPromises();
    // цена подставилась по тарифу 190
    expect((wrapper.find('[data-test="deliver-price"]').element as HTMLInputElement).value).toBe("950.00");

    await wrapper.find('[data-test="deliver-btn"]').trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/users/7/packages/status", {
      ids: [100],
      status: "DELIVERED",
      weight: 5,
      price: "950.00",
    });
    expect(wrapper.text()).toContain("Выдано посылок: 1");
  });

  it("keeps the deliver button disabled with no selection", async () => {
    wrapper = mount(DeliveryView);
    await flushPromises();
    await wrapper.findAll('[data-test="client-row"]')[0].trigger("click");
    await flushPromises();
    expect((wrapper.find('[data-test="deliver-btn"]').element as HTMLButtonElement).disabled).toBe(true);
  });
});
