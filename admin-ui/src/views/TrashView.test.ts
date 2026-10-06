import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

import TrashView from "./TrashView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const trashed = {
  id: 48, client_code: "DIX-0017", full_name: "Джанабаева Кызжибек", phone: "220381256",
  deleted_at: "2026-10-01T10:00:00Z", packages_count: 8,
};

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.delete).mockReset().mockResolvedValue({ ok: true });
});

describe("TrashView", () => {
  it("shows an empty state", async () => {
    vi.mocked(api.get).mockResolvedValue({ users: [] });
    const wrapper = mount(TrashView, globalStubs);
    await flushPromises();
    expect(wrapper.find('[data-test="trash-empty"]').exists()).toBe(true);
  });

  it("lists trashed users with their package counts", async () => {
    vi.mocked(api.get).mockResolvedValue({ users: [trashed] });
    const wrapper = mount(TrashView, globalStubs);
    await flushPromises();
    const row = wrapper.find('[data-test="trash-row"]');
    expect(row.text()).toContain("DIX-0017");
    expect(row.text()).toContain("8");
  });

  it("restores a user", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ users: [trashed] }).mockResolvedValueOnce({ users: [] });
    const wrapper = mount(TrashView, globalStubs);
    await flushPromises();
    await wrapper.find('[data-test="restore"]').trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/admin/trash/48/restore");
    expect(wrapper.text()).toContain("восстановлен");
  });

  it("deletes permanently only after confirmation", async () => {
    vi.mocked(api.get).mockResolvedValue({ users: [trashed] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(TrashView, globalStubs);
    await flushPromises();

    await wrapper.find('[data-test="purge"]').trigger("click");
    await flushPromises();
    expect(api.delete).not.toHaveBeenCalled();

    await wrapper.find('[data-test="purge"]').trigger("click");
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/admin/trash/48");
    confirmSpy.mockRestore();
  });
});
