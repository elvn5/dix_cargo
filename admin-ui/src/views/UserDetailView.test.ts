import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() } };
});

const routeState = { params: { id: "1" }, query: {} as Record<string, string> };
const push = vi.fn();
const replace = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push, replace }),
}));

import UserDetailView from "./UserDetailView.vue";
import { api, ApiError } from "../api/client";

const globalStubs = { global: { stubs: { RouterLink: { template: "<a><slot/></a>" } } } };

function userDetail(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 1, client_code: "DIX-0001", full_name: "Иван Иванов", phone: "500100500", telegram_id: "555", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    packages: [],
    tariff: 0,
    ...overrides,
  };
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(api.post).mockReset();
  push.mockReset();
  replace.mockReset();
  routeState.params = { id: "1" };
  routeState.query = {};
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("UserDetailView — load", () => {
  it("shows a loading state, then the user's form", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    wrapper = mount(UserDetailView, globalStubs);
    expect(wrapper.text()).toContain("Загрузка");
    await flushPromises();
    expect((wrapper.find('input[required]').element as HTMLInputElement).value).toBe("DIX-0001");
  });

  it("redirects to /users on a 404", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, "not_found"));
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    expect(replace).toHaveBeenCalledWith("/users");
  });

  it("shows the empty packages state", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Посылок нет");
  });

  it("shows saved/pkg_saved banners based on the query string", async () => {
    routeState.query = { saved: "1", pkg_saved: "1" };
    vi.mocked(api.get).mockResolvedValue(userDetail());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    expect(wrapper.text()).toContain("Изменения сохранены");
    expect(wrapper.text()).toContain("Статусы обновлены");
  });
});

describe("UserDetailView — save form", () => {
  it("saves and shows a success banner", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    vi.mocked(api.put).mockResolvedValue({ user: {} });
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith("/admin/users/1", { client_code: "DIX-0001", full_name: "Иван Иванов", phone: "500100500" });
    expect(replace).toHaveBeenCalledWith({ query: { saved: "1" } });
    expect(wrapper.text()).toContain("Изменения сохранены");
  });

  it("shows a duplicate_code error", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    vi.mocked(api.put).mockRejectedValue(new ApiError(409, "duplicate_code"));
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("Код клиента уже занят");
  });

  it("shows a duplicate_phone error", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    vi.mocked(api.put).mockRejectedValue(new ApiError(409, "duplicate_phone"));
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("уже используется другим пользователем");
  });

  it("shows a generic error for unexpected save failures", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    vi.mocked(api.put).mockRejectedValue(new Error("boom"));
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(wrapper.text()).toContain("Не удалось сохранить изменения");
  });
});

describe("UserDetailView — delete", () => {
  it("deletes after confirmation and navigates back to the list", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue(userDetail());
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith("/admin/users/1");
    expect(push).toHaveBeenCalledWith("/users");
  });

  it("does nothing when the confirmation is dismissed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.get).mockResolvedValue(userDetail());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    await wrapper.find(".btn-outline-danger").trigger("click");
    await flushPromises();
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe("UserDetailView — packages table", () => {
  function twoPackages(overrides: Record<string, unknown> = {}) {
    return userDetail({
      packages: [
        { id: 10, track_code: "T1", status: "IN_TRANSIT", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
        { id: 11, track_code: "T2", status: "IN_OFFICE", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      ],
      tariff: 100,
      ...overrides,
    });
  }

  it("selects individual rows and the select-all checkbox", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const checkboxes = wrapper.findAll('input[type=checkbox]');
    expect(checkboxes).toHaveLength(3); // select-all + 2 rows

    await checkboxes[1].setValue(true);
    expect(wrapper.text()).toContain("Выбрано: 1");

    await checkboxes[0].setValue(true); // select all
    expect(wrapper.text()).toContain("Выбрано: 2");

    await checkboxes[0].setValue(false); // deselect all
    expect(wrapper.text()).toContain("Выбрано: 0");
  });

  it("auto-calculates price from weight using the tariff when status is IN_OFFICE", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    await wrapper.find("select").setValue("IN_OFFICE");
    const weightInput = wrapper.find('input[placeholder="кг"]');
    await weightInput.setValue("2");
    await flushPromises();

    const priceInput = wrapper.find('input[placeholder="сом"]');
    expect((priceInput.element as HTMLInputElement).value).toBe("200.00");
  });

  it("shows the tariff next to the bulk price input", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    await wrapper.find("select").setValue("IN_OFFICE");
    expect(wrapper.find('[data-test="tariff-hint"]').text()).toContain("100");
    expect(wrapper.find('[data-test="tariff-missing"]').exists()).toBe(false);
  });

  it("warns when no tariff is configured", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages({ tariff: 0 }));
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    await wrapper.find("select").setValue("IN_OFFICE");
    expect(wrapper.find('[data-test="tariff-missing"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="tariff-hint"]').exists()).toBe(false);
  });

  it("shows total weight and payable sum of the selected packages when status is DELIVERED", async () => {
    vi.mocked(api.get).mockResolvedValue(
      userDetail({
        tariff: 100,
        packages: [
          { id: 10, track_code: "T1", status: "IN_OFFICE", weight: 2, price: 200, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
          { id: 11, track_code: "T2", status: "IN_OFFICE", weight: 1.5, price: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
          { id: 12, track_code: "T3", status: "IN_OFFICE", weight: null, price: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    // No summary until DELIVERED is chosen with a selection
    await wrapper.find("select").setValue("DELIVERED");
    expect(wrapper.find('[data-test="delivered-summary"]').exists()).toBe(false);

    const checkboxes = wrapper.findAll("input[type=checkbox]");
    await checkboxes[0].setValue(true); // select all three
    await flushPromises();

    // Weight = 2 + 1.5 = 3.5 (T3 has no weight)
    expect(wrapper.find('[data-test="delivered-weight"]').text()).toBe("3.5");
    // Sum = 200 (stored) + 1.5*100 (by tariff) = 350
    expect(wrapper.find('[data-test="delivered-price"]').text()).toBe("350");
    // One selected package has no weight
    expect(wrapper.find('[data-test="delivered-missing"]').text()).toContain("1");
  });

  it("applies a bulk status update and reloads", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const checkboxes = wrapper.findAll('input[type=checkbox]');
    await checkboxes[1].setValue(true);
    await wrapper.find("select").setValue("IN_OFFICE");
    await wrapper.find('input[placeholder="кг"]').setValue("2");

    await wrapper.find(".btn-primary.btn-sm").trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/users/1/packages/status", {
      ids: [10], status: "IN_OFFICE", weight: 2, price: "200.00",
    });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("does nothing when applying with no selection", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    const applyBtn = wrapper.find(".btn-primary.btn-sm");
    expect((applyBtn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes selected packages after confirmation and reloads", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const checkboxes = wrapper.findAll('input[type=checkbox]');
    await checkboxes[1].setValue(true);

    const deleteBtn = wrapper.findAll(".btn-outline-danger.btn-sm").find((b) => b.text() === "Удалить");
    await deleteBtn!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/users/1/packages/delete", { ids: [10] });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("does not delete selected packages when the confirmation is dismissed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const checkboxes = wrapper.findAll('input[type=checkbox]');
    await checkboxes[1].setValue(true);
    const deleteBtn = wrapper.findAll(".btn-outline-danger.btn-sm").find((b) => b.text() === "Удалить");
    await deleteBtn!.trigger("click");
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
  });

  it("disables the delete-selected button with no selection", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    const deleteBtn = wrapper.findAll(".btn-outline-danger.btn-sm").find((b) => b.text() === "Удалить");
    expect((deleteBtn!.element as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("UserDetailView — add package modal", () => {
  function twoPackages(overrides: Record<string, unknown> = {}) {
    return userDetail({
      packages: [
        { id: 10, track_code: "T1", status: "IN_TRANSIT", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
        { id: 11, track_code: "T2", status: "IN_OFFICE", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      ],
      tariff: 100,
      ...overrides,
    });
  }

  it("is hidden by default and opens from the footer button", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    expect(wrapper.text()).not.toContain("Новая посылка");
    const addBtn = wrapper.findAll(".btn-outline.btn-sm").find((b) => b.text().includes("Добавить"));
    await addBtn!.trigger("click");
    expect(wrapper.text()).toContain("Новая посылка");
  });

  it("opens from the empty-state button when there are no packages", async () => {
    vi.mocked(api.get).mockResolvedValue(userDetail());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    expect(wrapper.text()).toContain("Посылок нет");
    const addBtn = wrapper.findAll("button").find((b) => b.text().includes("Добавить"));
    await addBtn!.trigger("click");
    expect(wrapper.text()).toContain("Новая посылка");
  });

  it("submits the new package for the current user and reloads", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    vi.mocked(api.post).mockResolvedValue({ package: {} });
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const addBtn = wrapper.findAll(".btn-outline.btn-sm").find((b) => b.text().includes("Добавить"));
    await addBtn!.trigger("click");

    await wrapper.find('input[placeholder="RU123456789CN"]').setValue("RU999");
    const forms = wrapper.findAll("form");
    await forms[forms.length - 1].trigger("submit.prevent");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/admin/packages", {
      user_id: 1, track_code: "RU999", status: "IN_TRANSIT", weight: undefined, price: undefined,
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain("Новая посылка");
  });

  it("auto-calculates price from weight using the tariff", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const addBtn = wrapper.findAll(".btn-outline.btn-sm").find((b) => b.text().includes("Добавить"));
    await addBtn!.trigger("click");

    const inputs = wrapper.findAll('input[type="number"]');
    await inputs[0].setValue("3");
    await flushPromises();
    expect((inputs[1].element as HTMLInputElement).value).toBe("300.00");
  });

  it("closes without saving via the cancel button", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const addBtn = wrapper.findAll(".btn-outline.btn-sm").find((b) => b.text().includes("Добавить"));
    await addBtn!.trigger("click");
    expect(wrapper.text()).toContain("Новая посылка");

    const cancelBtn = wrapper.findAll("button").find((b) => b.text() === "Отмена");
    await cancelBtn!.trigger("click");
    expect(wrapper.text()).not.toContain("Новая посылка");
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("UserDetailView — barcode scanner", () => {
  function twoPackages() {
    return userDetail({
      packages: [
        { id: 10, track_code: "T1", status: "IN_TRANSIT", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      ],
    });
  }

  function type(text: string) {
    for (const ch of text) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  }

  it("selects a package scanned by track code", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    type("T1");
    await flushPromises();

    expect(wrapper.text()).toContain("Выбрано: 1");
    expect(wrapper.text()).toContain("✓ T1");
  });

  it("reports an unknown scanned code", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    type("UNKNOWN");
    await flushPromises();

    expect(wrapper.text()).toContain("не найден");
  });

  it("ignores keystrokes while focused in an input", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();

    const input = wrapper.find("select").element;
    document.dispatchEvent(Object.assign(new KeyboardEvent("keydown", { key: "T" }), {}));
    Object.defineProperty(document, "activeElement", { value: input, configurable: true });
    const evt = new KeyboardEvent("keydown", { key: "1" });
    Object.defineProperty(evt, "target", { value: input });
    document.dispatchEvent(evt);

    expect(wrapper.text()).not.toContain("Выбрано: 1");
  });

  it("ignores an empty Enter press", async () => {
    vi.mocked(api.get).mockResolvedValue(twoPackages());
    wrapper = mount(UserDetailView, globalStubs);
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    expect(wrapper.text()).not.toContain("не найден");
  });
});
