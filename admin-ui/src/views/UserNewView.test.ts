import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import UserNewView from "./UserNewView.vue";
import { api, ApiError } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ codePrefix: "DIX" });
  vi.mocked(api.post).mockReset();
  push.mockReset();
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("UserNewView", () => {
  it("loads the branch's client-code prefix for the placeholder", async () => {
    vi.mocked(api.get).mockResolvedValue({ codePrefix: "KADIX" });
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    expect(wrapper.find('input[placeholder="KADIX-0001"]').exists()).toBe(true);
  });

  it("flags an invalid phone on submit without calling the API", async () => {
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="Иванов Иван Иванович"]').setValue("Иван Иванов");
    await wrapper.find('input[placeholder="500123123"]').setValue("abc");
    await wrapper.find("form").trigger("submit.prevent");

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Введите ровно 9 цифр");
  });

  it("creates the user and redirects to their profile", async () => {
    vi.mocked(api.post).mockResolvedValue({ user: { id: 42 } });
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="Иванов Иван Иванович"]').setValue("Иван Иванов");
    await wrapper.find('input[placeholder="500123123"]').setValue("500123123");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/users", {
      full_name: "Иван Иванов", phone: "500123123", client_code: "", telegram_id: "",
    });
    expect(push).toHaveBeenCalledWith("/users/42?saved=1");
  });

  it("submits an explicit client code and Telegram ID when provided", async () => {
    vi.mocked(api.post).mockResolvedValue({ user: { id: 7 } });
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="Иванов Иван Иванович"]').setValue("Пётр Петров");
    await wrapper.find('input[placeholder="500123123"]').setValue("500123123");
    await wrapper.find('input[placeholder="DIX-0001"]').setValue("DIX-0042");
    await wrapper.find('input[placeholder="123456789"]').setValue("777");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/users", {
      full_name: "Пётр Петров", phone: "500123123", client_code: "DIX-0042", telegram_id: 777,
    });
  });

  it("shows a phone-format error from the server", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(400, "phone"));
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="Иванов Иван Иванович"]').setValue("Иван Иванов");
    await wrapper.find('input[placeholder="500123123"]').setValue("500123123");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("Неверный формат телефона");
  });

  it("shows a duplicate-phone error from the server", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, "duplicate_phone"));
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="Иванов Иван Иванович"]').setValue("Иван Иванов");
    await wrapper.find('input[placeholder="500123123"]').setValue("500123123");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("уже используется другим пользователем");
  });

  it("shows a generic error for unexpected failures", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    const wrapper = mount(UserNewView, globalStubs);
    await flushPromises();
    await wrapper.find('input[placeholder="Иванов Иван Иванович"]').setValue("Иван Иванов");
    await wrapper.find('input[placeholder="500123123"]').setValue("500123123");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("Не удалось создать пользователя");
  });
});
