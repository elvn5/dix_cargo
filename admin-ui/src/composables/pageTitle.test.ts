import { describe, it, expect } from "vitest";
import { pageTitle } from "./pageTitle";

describe("pageTitle", () => {
  it("is a shared, mutable ref", () => {
    pageTitle.value = "Дашборд";
    expect(pageTitle.value).toBe("Дашборд");
    pageTitle.value = "Пользователи";
    expect(pageTitle.value).toBe("Пользователи");
  });
});
