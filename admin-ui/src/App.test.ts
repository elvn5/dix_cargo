import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

const routeState = { meta: {} as Record<string, unknown> };
vi.mock("vue-router", () => ({ useRoute: () => routeState }));

import App from "./App.vue";

const globalStubs = {
  global: {
    stubs: {
      AdminLayout: { template: "<div class='layout'><slot/></div>" },
      RouterView: { template: "<div class='view'>view</div>" },
    },
  },
};

describe("App", () => {
  it("wraps protected routes in AdminLayout", () => {
    routeState.meta = {};
    const wrapper = mount(App, globalStubs);
    expect(wrapper.find(".layout").exists()).toBe(true);
    expect(wrapper.find(".view").exists()).toBe(true);
  });

  it("renders public routes (like login) without the layout", () => {
    routeState.meta = { public: true };
    const wrapper = mount(App, globalStubs);
    expect(wrapper.find(".layout").exists()).toBe(false);
    expect(wrapper.find(".view").exists()).toBe(true);
  });
});
