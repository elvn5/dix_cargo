import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import ResetRequestsView from "./ResetRequestsView.vue";
import { api } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function fakeRequest(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    requested_telegram_id: "999",
    status: "PENDING",
    created_at: "2026-01-01T00:00:00Z",
    resolved_at: null,
    user: { id: 5, client_code: "DIX-0005", full_name: "Иван Иванов", phone: "500100500", telegram_id: "555" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ResetRequestsView", () => {
  it("shows the empty state", async () => {
    vi.mocked(api.get).mockResolvedValue({ requests: [] });
    const wrapper = mount(ResetRequestsView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Заявок нет");
  });

  it("lists a pending request with approve/reject buttons", async () => {
    vi.mocked(api.get).mockResolvedValue({ requests: [fakeRequest()] });
    const wrapper = mount(ResetRequestsView, globalStubs);
    await flushPromises();

    expect(wrapper.text()).toContain("DIX-0005");
    expect(wrapper.text()).toContain("Иван Иванов");
    expect(wrapper.text()).toContain("555");
    expect(wrapper.text()).toContain("999");
    expect(wrapper.text()).toContain("Ожидает");
    expect(wrapper.find(".btn-outline-success").exists()).toBe(true);
    expect(wrapper.find(".btn-outline-danger").exists()).toBe(true);
  });

  it("hides action buttons for a resolved request", async () => {
    vi.mocked(api.get).mockResolvedValue({ requests: [fakeRequest({ status: "APPROVED" })] });
    const wrapper = mount(ResetRequestsView, globalStubs);
    await flushPromises();

    expect(wrapper.text()).toContain("Одобрено");
    expect(wrapper.find(".btn-outline-success").exists()).toBe(false);
    expect(wrapper.find(".btn-outline-danger").exists()).toBe(false);
  });

  it("approves after confirmation and reloads the list", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue({ requests: [fakeRequest()] });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const wrapper = mount(ResetRequestsView, globalStubs);
    await flushPromises();

    await wrapper.find(".btn-outline-success").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/reset-requests/1/approve");
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("does not approve when the confirmation is dismissed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.get).mockResolvedValue({ requests: [fakeRequest()] });
    const wrapper = mount(ResetRequestsView, globalStubs);
    await flushPromises();

    await wrapper.find(".btn-outline-success").trigger("click");
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects after confirmation and reloads the list", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue({ requests: [fakeRequest()] });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const wrapper = mount(ResetRequestsView, globalStubs);
    await flushPromises();

    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/reset-requests/1/reject");
  });
});
