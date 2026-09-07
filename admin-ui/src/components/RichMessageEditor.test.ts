import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import RichMessageEditor from "./RichMessageEditor.vue";

beforeEach(() => {
  document.execCommand = vi.fn().mockReturnValue(true);
});

describe("RichMessageEditor", () => {
  it("renders the formatting toolbar", () => {
    const wrapper = mount(RichMessageEditor);
    for (const cmd of ["bold", "italic", "underline", "strike", "code", "link", "clear"]) {
      expect(wrapper.find(`[data-test=fmt-${cmd}]`).exists()).toBe(true);
    }
  });

  it("emits change on mount and on input", async () => {
    const wrapper = mount(RichMessageEditor);
    expect(wrapper.emitted("change")).toBeTruthy();

    const editor = wrapper.find("[data-test=editor]");
    editor.element.innerHTML = "<b>hi</b>";
    await editor.trigger("input");

    const events = wrapper.emitted("change")!;
    expect(events[events.length - 1][0]).toEqual({ html: "<b>hi</b>", length: 2 });
  });

  it("applies bold via execCommand", async () => {
    const wrapper = mount(RichMessageEditor);
    await wrapper.find("[data-test=fmt-bold]").trigger("click");
    expect(document.execCommand).toHaveBeenCalledWith("bold");
  });

  it("wraps the selection in <code>", async () => {
    window.getSelection = vi.fn(() => ({ toString: () => "sel", isCollapsed: false })) as unknown as typeof window.getSelection;
    const wrapper = mount(RichMessageEditor);
    await wrapper.find("[data-test=fmt-code]").trigger("click");
    expect(document.execCommand).toHaveBeenCalledWith("insertHTML", false, "<code>sel</code>");
  });

  it("creates a link from a prompt, adding https when missing", async () => {
    window.getSelection = vi.fn(() => ({ toString: () => "sel", isCollapsed: false })) as unknown as typeof window.getSelection;
    vi.spyOn(window, "prompt").mockReturnValue("example.com");
    const wrapper = mount(RichMessageEditor);
    await wrapper.find("[data-test=fmt-link]").trigger("click");
    expect(document.execCommand).toHaveBeenCalledWith("createLink", false, "https://example.com");
  });

  it("does not create a link when nothing is selected", async () => {
    window.getSelection = vi.fn(() => ({ toString: () => "", isCollapsed: true })) as unknown as typeof window.getSelection;
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const wrapper = mount(RichMessageEditor);
    await wrapper.find("[data-test=fmt-link]").trigger("click");
    expect(document.execCommand).not.toHaveBeenCalledWith("createLink", false, expect.anything());
  });

  it("clears formatting", async () => {
    const wrapper = mount(RichMessageEditor);
    await wrapper.find("[data-test=fmt-clear]").trigger("click");
    expect(document.execCommand).toHaveBeenCalledWith("removeFormat");
    expect(document.execCommand).toHaveBeenCalledWith("unlink");
  });

  it("reset() empties the editor and emits change", async () => {
    const wrapper = mount(RichMessageEditor);
    const editor = wrapper.find("[data-test=editor]");
    editor.element.innerHTML = "<b>hi</b>";
    (wrapper.vm as unknown as { reset: () => void }).reset();
    expect(editor.element.innerHTML).toBe("");
    const events = wrapper.emitted("change")!;
    expect(events[events.length - 1][0]).toEqual({ html: "", length: 0 });
  });
});
