import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import MarketplacesView from "./MarketplacesView.vue";
import { api } from "../api/client";

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("MarketplacesView", () => {
  it("renders all four marketplace sections with defaults when nothing is saved", async () => {
    vi.mocked(api.get).mockResolvedValue({ sections: [] });
    const wrapper = mount(MarketplacesView);
    await flushPromises();
    expect(wrapper.text()).toContain("Pinduoduo");
    expect(wrapper.text()).toContain("TaoBao");
    expect(wrapper.text()).toContain("1688");
    expect(wrapper.text()).toContain("Poizon");
    expect(wrapper.findAll("textarea")).toHaveLength(4);
  });

  it("fills in saved values and upload badges", async () => {
    vi.mocked(api.get).mockResolvedValue({
      sections: [{ key: "marketplace_pinduoduo", value: "custom text", hasPhoto: true, hasVideo: false }],
    });
    const wrapper = mount(MarketplacesView);
    await flushPromises();
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("custom text");
    expect(wrapper.text()).toContain("уже загружено");
  });

  it("saves text-only changes", async () => {
    vi.mocked(api.get).mockResolvedValue({ sections: [] });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const wrapper = mount(MarketplacesView);
    await flushPromises();

    await wrapper.find("textarea").setValue("new text");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/marketplaces", expect.any(FormData));
    const form = vi.mocked(api.post).mock.calls[0][1] as FormData;
    expect(form.get("marketplace_pinduoduo")).toBe("new text");
    expect(wrapper.text()).toContain("Изменения сохранены");
  });

  it("includes a selected file in the saved form data", async () => {
    vi.mocked(api.get).mockResolvedValue({ sections: [] });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const wrapper = mount(MarketplacesView);
    await flushPromises();

    const photoInput = wrapper.findAll("input[type=file]")[0];
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(photoInput.element, "files", { value: [file], writable: false });
    await photoInput.trigger("change");

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    const form = vi.mocked(api.post).mock.calls[0][1] as FormData;
    expect(form.get("pinduoduo_photo")).toBe(file);
  });
});
