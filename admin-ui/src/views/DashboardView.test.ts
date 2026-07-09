import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn() } };
});

import DashboardView from "./DashboardView.vue";
import { api } from "../api/client";

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

const globalStubs = { stubs: { RouterLink: { template: "<a><slot/></a>" } } };

describe("DashboardView", () => {
  it("shows a loading state before data arrives", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const wrapper = mount(DashboardView, globalStubs);
    expect(wrapper.text()).toContain("Загрузка");
  });

  it("renders stats and the latest users once loaded", async () => {
    vi.mocked(api.get).mockResolvedValue({
      totalUsers: 2,
      totalPackages: 21,
      pkgOffice: 1,
      pkgTransit: 20,
      pkgDelivered: 0,
      period: { usersDay: 0, usersWeek: 0, usersMonth: 0, usersYear: 2, pkgDay: 0, pkgWeek: 0, pkgMonth: 0, pkgYear: 21 },
      latestUsers: [
        { id: 5, client_code: "DIX-1222", full_name: "Иван", phone: "500100500", created_at: "2026-04-23T12:55:08.112Z" },
      ],
    });

    const wrapper = mount(DashboardView, globalStubs);
    await flushPromises();

    expect(wrapper.text()).toContain("DIX-1222");
    expect(wrapper.text()).toContain("21");
    expect(wrapper.text()).not.toContain("Загрузка");
  });

  it("shows an empty state when there are no users yet", async () => {
    vi.mocked(api.get).mockResolvedValue({
      totalUsers: 0, totalPackages: 0, pkgOffice: 0, pkgTransit: 0, pkgDelivered: 0,
      period: { usersDay: 0, usersWeek: 0, usersMonth: 0, usersYear: 0, pkgDay: 0, pkgWeek: 0, pkgMonth: 0, pkgYear: 0 },
      latestUsers: [],
    });
    const wrapper = mount(DashboardView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Нет данных");
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
