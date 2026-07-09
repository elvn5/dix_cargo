import { describe, it, expect } from "vitest";
import { parseClientCode } from "./parseClientCode";

describe("parseClientCode", () => {
  it("plain number — padded to 4 digits", () => {
    expect(parseClientCode("2222")).toBe("DIX-2222");
    expect(parseClientCode("8")).toBe("DIX-0008");
    expect(parseClientCode("24")).toBe("DIX-0024");
    expect(parseClientCode("1920")).toBe("DIX-1920");
  });

  it("DIX with dash", () => {
    expect(parseClientCode("DIX-0022")).toBe("DIX-0022");
    expect(parseClientCode("DIX-22")).toBe("DIX-0022");
    expect(parseClientCode("dix-9999")).toBe("DIX-9999");
  });

  it("DIX without separator (slug)", () => {
    expect(parseClientCode("DIX2222")).toBe("DIX-2222");
    expect(parseClientCode("DIX0008")).toBe("DIX-0008");
  });

  it("DIX with space", () => {
    expect(parseClientCode("DIX 2222")).toBe("DIX-2222");
    expect(parseClientCode("DIX 8")).toBe("DIX-0008");
  });

  it("trims surrounding whitespace", () => {
    expect(parseClientCode("  2222  ")).toBe("DIX-2222");
    expect(parseClientCode(" DIX-0042 ")).toBe("DIX-0042");
  });

  it("returns null for non-code values", () => {
    expect(parseClientCode("客户唛头")).toBeNull();
    expect(parseClientCode("")).toBeNull();
    expect(parseClientCode(null)).toBeNull();
    expect(parseClientCode(undefined)).toBeNull();
    expect(parseClientCode("трек")).toBeNull();
    expect(parseClientCode("JT5485640575332")).toBeNull();
  });

  it("supports a custom prefix (Кант — DIX2)", () => {
    expect(parseClientCode("2222", "DIX2")).toBe("DIX2-2222");
    expect(parseClientCode("DIX2-0022", "DIX2")).toBe("DIX2-0022");
    expect(parseClientCode("DIX2 22", "DIX2")).toBe("DIX2-0022");
    expect(parseClientCode("dix2-9999", "DIX2")).toBe("DIX2-9999");
    expect(parseClientCode("DIX-2222", "DIX2")).toBeNull();
  });
});
