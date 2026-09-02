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

const PREVIEW = {
  dryRun: true,
  imported: 0,
  skipped: 1,
  shippingDate: "2025-04-18T00:00:00.000Z",
  toImport: 2,
  toSkip: 1,
  unrecognized: 0,
  itemsTruncated: false,
  errors: ["DIX-9999: пользователь не найден"],
  items: [
    { clientCode: "DIX-0001", trackCode: "TRACK1", userName: "Иван Иванов", action: "import" },
    { clientCode: "DIX-9999", trackCode: "TRACK2", userName: null, action: "skip", reason: "user_not_found" },
  ],
};

const RESULT = { ...PREVIEW, dryRun: false, imported: 2, skipped: 1 };

async function selectFileAndSubmit(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.find("input[type=file]");
  const file = new File(["a,b"], "import.xlsx");
  Object.defineProperty(input.element, "files", { value: [file], writable: false });
  await input.trigger("change");
  await wrapper.find("form").trigger("submit.prevent");
  await flushPromises();
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((b) => b.text().includes(text));
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

  it("first click builds a preview (dry-run) without importing", async () => {
    vi.mocked(api.post).mockResolvedValue(PREVIEW);
    const wrapper = mount(PackagesImportView, globalStubs);
    await flushPromises();

    await selectFileAndSubmit(wrapper);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/admin/packages/import?dryRun=1", expect.any(FormData));
    expect(wrapper.text()).toContain("Предпросмотр изменений");
    expect(wrapper.text()).toContain("Добавить");
    expect(wrapper.text()).toContain("DIX-0001");
    // preview only — no final success summary yet
    expect(wrapper.text()).not.toContain("Импортировано");
    expect(findButton(wrapper, "Подтвердить импорт")).toBeTruthy();
    expect(findButton(wrapper, "Отмена")).toBeTruthy();
  });

  it("confirm applies the import and shows the result summary", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce(RESULT);
    const wrapper = mount(PackagesImportView, globalStubs);
    await flushPromises();

    await selectFileAndSubmit(wrapper);
    await findButton(wrapper, "Подтвердить импорт")!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenNthCalledWith(2, "/admin/packages/import", expect.any(FormData));
    expect(wrapper.text()).toContain("Импортировано");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.text()).toContain("DIX-9999: пользователь не найден");
  });

  it("cancel discards the preview and imports nothing", async () => {
    vi.mocked(api.post).mockResolvedValue(PREVIEW);
    const wrapper = mount(PackagesImportView, globalStubs);
    await flushPromises();

    await selectFileAndSubmit(wrapper);
    expect(wrapper.text()).toContain("Предпросмотр изменений");

    await findButton(wrapper, "Отмена")!.trigger("click");
    await flushPromises();

    // back to the form, only the single preview call was made
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain("Предпросмотр изменений");
    expect(wrapper.find("input[type=file]").exists()).toBe(true);
  });
});
