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
  it("loads manager buttons returned by the API", async () => {
    vi.mocked(api.get).mockResolvedValue({
      settings: {},
      managers: [{ name: "Лидия", url: "https://wa.me/996550867414" }, { name: "Виктория", url: "https://wa.me/996556969906" }],
    });
    const wrapper = mount(SettingsView);
    await flushPromises();
    const nameInputs = wrapper.findAll('input[placeholder="Имя менеджера"]');
    expect(nameInputs).toHaveLength(2);
    expect((nameInputs[0].element as HTMLInputElement).value).toBe("Лидия");
    expect((nameInputs[1].element as HTMLInputElement).value).toBe("Виктория");
  });

  it("falls back to one empty row when no managers are configured", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {}, managers: [] });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect(wrapper.findAll('input[placeholder="Имя менеджера"]')).toHaveLength(1);
  });

  it("loads saved values when present", async () => {
    vi.mocked(api.get).mockResolvedValue({
      settings: { tariff_per_kg: "150", forbidden_items: "золото", support_text: "💬 Поддержка" },
      managers: [{ name: "Аня", url: "https://wa.me/1" }],
    });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect((wrapper.find('input[type=number]').element as HTMLInputElement).value).toBe("150");
    expect((wrapper.find('[data-test="forbidden-items"]').element as HTMLTextAreaElement).value).toBe("золото");
    expect((wrapper.find('[data-test="support-text"]').element as HTMLTextAreaElement).value).toBe("💬 Поддержка");
  });

  it("saves the edited support message", async () => {
    vi.mocked(api.get).mockResolvedValue({
      settings: { support_text: "старый текст" },
      managers: [{ name: "Аня", url: "https://wa.me/1" }],
    });
    vi.mocked(api.put).mockResolvedValue({ ok: true });
    const wrapper = mount(SettingsView);
    await flushPromises();

    await wrapper.find('[data-test="support-text"]').setValue("новый текст поддержки");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith(
      "/admin/settings",
      expect.objectContaining({ support_text: "новый текст поддержки" }),
    );
  });

  it("adds and removes manager rows, allowing an unlimited number of buttons", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {}, managers: [{ name: "Лидия", url: "https://wa.me/1" }] });
    const wrapper = mount(SettingsView);
    await flushPromises();

    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-test="add-manager"]').trigger("click");
    }
    expect(wrapper.findAll('input[placeholder="Имя менеджера"]')).toHaveLength(5);

    await wrapper.findAll('[data-test="remove-manager"]')[0].trigger("click");
    expect(wrapper.findAll('input[placeholder="Имя менеджера"]')).toHaveLength(4);
  });

  it("disables the remove button when only one manager row remains", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {}, managers: [{ name: "Лидия", url: "https://wa.me/1" }] });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect(wrapper.find('[data-test="remove-manager"]').attributes("disabled")).toBeDefined();
  });

  it("saves and shows a success banner", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {}, managers: [{ name: "Лидия", url: "https://wa.me/1" }] });
    vi.mocked(api.put).mockResolvedValue({ ok: true });
    const wrapper = mount(SettingsView);
    await flushPromises();

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith(
      "/admin/settings",
      expect.objectContaining({ managers: [{ name: "Лидия", url: "https://wa.me/1" }] }),
    );
    expect(wrapper.text()).toContain("Изменения сохранены");
  });

  it("links to the db-dump download endpoint", async () => {
    vi.mocked(api.get).mockResolvedValue({ settings: {}, managers: [] });
    const wrapper = mount(SettingsView);
    await flushPromises();
    expect(wrapper.find('a[href="/api/admin/db-dump"]').exists()).toBe(true);
  });
});
