import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import PackagesImportView from "./PackagesImportView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ codePrefix: "DIX" });
  vi.mocked(api.post).mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PackagesImportView", () => {
  it("shows the branch's code-prefix examples", async () => {
    vi.mocked(api.get).mockResolvedValue({ codePrefix: "KADIX" });
    const wrapper = mount(PackagesImportView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("KADIX2222");
  });

  it("does nothing on submit without a selected file", async () => {
    const wrapper = mount(PackagesImportView, globalStubs);
    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("uploads the selected file and shows the result summary", async () => {
    vi.mocked(api.post).mockResolvedValue({ imported: 3, skipped: 1, errors: ["DIX-9999: пользователь не найден"] });
    const wrapper = mount(PackagesImportView, globalStubs);
    await flushPromises();

    const input = wrapper.find("input[type=file]");
    const file = new File(["a,b"], "import.xlsx");
    Object.defineProperty(input.element, "files", { value: [file], writable: false });
    await input.trigger("change");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/packages/import", expect.any(FormData));
    expect(wrapper.text()).toContain("Импортировано");
    expect(wrapper.text()).toContain("3");
    expect(wrapper.text()).toContain("DIX-9999: пользователь не найден");
  });
});
