import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FileDropZone from "./FileDropZone.vue";

function makeFile(name = "photo.jpg") {
  return new File(["bytes"], name, { type: "image/jpeg" });
}

describe("FileDropZone", () => {
  it("shows the 'default' badge when nothing is selected or uploaded", () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    expect(wrapper.text()).toContain("дефолт");
  });

  it("shows the 'already uploaded' badge when alreadyUploaded is true", () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: true } });
    expect(wrapper.text()).toContain("уже загружено");
  });

  it("emits select and shows the filename when a file is chosen via the input", async () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    const input = wrapper.find("input[type=file]");
    const file = makeFile();
    Object.defineProperty(input.element, "files", { value: [file], writable: false });

    await input.trigger("change");

    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual([file]);
    expect(wrapper.text()).toContain("photo.jpg");
    expect(wrapper.text()).toContain("выбрано");
  });

  it("ignores a change event with no file", async () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    const input = wrapper.find("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [], writable: false });

    await input.trigger("change");
    expect(wrapper.emitted("select")).toBeFalsy();
  });

  it("toggles the drag-over class on dragover/dragleave", async () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    const zone = wrapper.find(".file-drop-zone");

    await zone.trigger("dragover");
    expect(zone.classes()).toContain("drag-over");

    await zone.trigger("dragleave");
    expect(zone.classes()).not.toContain("drag-over");
  });

  it("emits select on drop and clears the drag-over state", async () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    const zone = wrapper.find(".file-drop-zone");
    const file = makeFile("dropped.png");
    // jsdom's native `files` setter requires a real FileList; replace it with a plain
    // writable property so the component's `inputRef.value.files = ...` assignment succeeds.
    Object.defineProperty(wrapper.find("input[type=file]").element, "files", { value: undefined, writable: true });

    await zone.trigger("drop", { dataTransfer: { files: [file] } });

    expect(wrapper.emitted("select")![0]).toEqual([file]);
    expect(zone.classes()).not.toContain("drag-over");
  });

  it("ignores a drop with no files", async () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    const zone = wrapper.find(".file-drop-zone");
    await zone.trigger("drop", {});
    expect(wrapper.emitted("select")).toBeFalsy();
  });

  it("clicking the zone opens the file picker", async () => {
    const wrapper = mount(FileDropZone, { props: { accept: "image/*", icon: "bi-image", alreadyUploaded: false } });
    const input = wrapper.find("input[type=file]").element as HTMLInputElement;
    let clicked = false;
    input.click = () => { clicked = true; };

    await wrapper.find(".file-drop-zone").trigger("click");
    expect(clicked).toBe(true);
  });
});
