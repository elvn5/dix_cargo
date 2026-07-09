import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});

import SettingsView from "./SettingsView.vue";
import { api } from "../api/client";

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.put).mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SettingsView", () => {
  it("applies defaults for missing manager fields", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {} });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect((wrapper.find('input[placeholder="Лидия"]').element as HTMLInputElement).value).toBe("Лидия");
    expect((wrapper.find('input[placeholder="Виктория"]').element as HTMLInputElement).value).toBe("Виктория");
  });

  it("loads saved values when present", async () => {
    vi.mocked(api.get).mockResolvedValue({
      settings: {
        tariff_per_kg: "150", manager_1_name: "Аня", manager_1_url: "https://wa.me/1",
        manager_2_name: "Боря", manager_2_url: "https://wa.me/2", forbidden_items: "золото",
      },
    });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect((wrapper.find('input[type=number]').element as HTMLInputElement).value).toBe("150");
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("золото");
  });

  it("saves and shows a success banner", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {} });
    vi.mocked(api.put).mockResolvedValue({ ok: true });
    const wrapper = mount(SettingsView);
    await flushPromises();

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith("/admin/settings", expect.objectContaining({ manager_1_name: "Лидия" }));
    expect(wrapper.text()).toContain("Изменения сохранены");
  });

  it("links to the db-dump download endpoint", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {} });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect(wrapper.find('a[href="/api/admin/db-dump"]').exists()).toBe(true);
  });
});
