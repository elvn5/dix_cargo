import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import BroadcastView from "./BroadcastView.vue";
import RichMessageEditor from "../components/RichMessageEditor.vue";
import { api, ApiError } from "../api/client";

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.execCommand = vi.fn().mockReturnValue(true);
  (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:x");
  (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.mocked(api.get).mockReset().mockResolvedValue({ count: 42 });
  vi.mocked(api.post).mockReset().mockResolvedValue({ total: 42, sent: 40, failed: 2 });
});

function typeMessage(wrapper: ReturnType<typeof mount>, html: string, length = 2) {
  wrapper.findComponent(RichMessageEditor).vm.$emit("change", { html, length });
}

describe("BroadcastView", () => {
  it("loads and shows the audience count", async () => {
    const wrapper = mount(BroadcastView);
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/admin/broadcast/audience");
    expect(wrapper.find("[data-test=audience]").text()).toContain("42");
  });

  it("keeps the send button disabled when there is no content", async () => {
    const wrapper = mount(BroadcastView);
    await flushPromises();
    expect((wrapper.find("[data-test=send]").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables send once a message is typed and shows a preview", async () => {
    const wrapper = mount(BroadcastView);
    await flushPromises();
    typeMessage(wrapper, "<b>hi</b>");
    await flushPromises();
    expect((wrapper.find("[data-test=send]").element as HTMLButtonElement).disabled).toBe(false);
    expect(wrapper.find("[data-test=preview]").html()).toContain("<b>hi</b>");
  });

  it("disables send when the text exceeds the Telegram limit", async () => {
    const wrapper = mount(BroadcastView);
    await flushPromises();
    typeMessage(wrapper, "a".repeat(4097), 4097);
    await flushPromises();
    expect((wrapper.find("[data-test=send]").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the broadcast as FormData and shows the result", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(BroadcastView);
    await flushPromises();
    typeMessage(wrapper, "<b>hi</b>");
    await flushPromises();

    await wrapper.find("[data-test=send]").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe("/admin/broadcast");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("text")).toBe("<b>hi</b>");
    expect(wrapper.find("[data-test=result]").text()).toContain("40");
  });

  it("does not send when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(BroadcastView);
    await flushPromises();
    typeMessage(wrapper, "<b>hi</b>");
    await flushPromises();
    await wrapper.find("[data-test=send]").trigger("click");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows an error message when the request fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.post).mockRejectedValue(new ApiError(400, "bad"));
    const wrapper = mount(BroadcastView);
    await flushPromises();
    typeMessage(wrapper, "<b>hi</b>");
    await flushPromises();
    await wrapper.find("[data-test=send]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-test=error]").exists()).toBe(true);
  });

  it("adds and removes attached files", async () => {
    const wrapper = mount(BroadcastView);
    await flushPromises();
    const input = wrapper.find("[data-test=file-input]");
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    Object.defineProperty(input.element, "files", { value: [file], writable: true });
    await input.trigger("change");

    expect(wrapper.find("[data-test=file-list]").text()).toContain("doc.pdf");
    // with a file attached, send is enabled even without text
    expect((wrapper.find("[data-test=send]").element as HTMLButtonElement).disabled).toBe(false);

    await wrapper.find("[data-test=remove-file]").trigger("click");
    expect(wrapper.find("[data-test=file-list]").exists()).toBe(false);
  });
});
