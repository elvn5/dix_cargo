import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

import PromoCodesView from "./PromoCodesView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.delete).mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PromoCodesView", () => {
  it("shows the empty state", async () => {
    vi.mocked(api.get).mockResolvedValue({ promos: [] });
    const wrapper = mount(PromoCodesView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Промокодов нет");
  });

  it("shows an unclaimed promo as active", async () => {
    vi.mocked(api.get).mockResolvedValue({
      promos: [{ id: 1, code: "SUMMER25", description: null, claimed_at: null, claimer: null }],
    });
    const wrapper = mount(PromoCodesView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("SUMMER25");
    expect(wrapper.text()).toContain("Активен");
    expect(wrapper.text()).toContain("—"); // no description
  });

  it("shows a claimed promo with the claimer's info", async () => {
    vi.mocked(api.get).mockResolvedValue({
      promos: [{
        id: 1, code: "SUMMER25", description: "10% скидка", claimed_at: "2026-01-01T00:00:00Z",
        claimer: { id: 5, client_code: "DIX-0005", full_name: "Иван Иванов" },
      }],
    });
    const wrapper = mount(PromoCodesView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("DIX-0005");
    expect(wrapper.text()).toContain("Иван Иванов");
    expect(wrapper.text()).toContain("10% скидка");
  });

  it("creates a promo and reloads the list", async () => {
    vi.mocked(api.get).mockResolvedValue({ promos: [] });
    vi.mocked(api.post).mockResolvedValue({ promo: {} });
    const wrapper = mount(PromoCodesView, globalStubs);
    await flushPromises();

    await wrapper.find("input.font-mono").setValue("WINTER10");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/promocodes", { code: "WINTER10", description: "" });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect((wrapper.find("input.font-mono").element as HTMLInputElement).value).toBe("");
  });

  it("deletes after confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue({ promos: [{ id: 1, code: "X", description: null, claimed_at: null, claimer: null }] });
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    const wrapper = mount(PromoCodesView, globalStubs);
    await flushPromises();

    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith("/admin/promocodes/1");
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.get).mockResolvedValue({ promos: [{ id: 1, code: "X", description: null, claimed_at: null, claimer: null }] });
    const wrapper = mount(PromoCodesView, globalStubs);
    await flushPromises();
    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
