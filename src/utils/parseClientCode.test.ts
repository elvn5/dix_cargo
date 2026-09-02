import { describe, it, expect } from "vitest";
import { parseClientCode } from "./parseClientCode";

describe("parseClientCode", () => {
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

  it("plain number — client of the importing branch, padded and prefixed", () => {
    // Реальные складские файлы пишут «своих» клиентов голым числом (без префикса).
    expect(parseClientCode("2222")).toBe("DIX-2222");
    expect(parseClientCode("8")).toBe("DIX-0008");
    expect(parseClientCode("24")).toBe("DIX-0024");
    expect(parseClientCode("1920")).toBe("DIX-1920");
    expect(parseClientCode("18", "KADIX")).toBe("KADIX-0018");
    expect(parseClientCode("1920", "KADIX")).toBe("KADIX-1920");
  });

  it("supports a custom prefix (Кант — KADIX)", () => {
    expect(parseClientCode("KADIX2222", "KADIX")).toBe("KADIX-2222");
    expect(parseClientCode("KADIX-0022", "KADIX")).toBe("KADIX-0022");
    expect(parseClientCode("KADIX 22", "KADIX")).toBe("KADIX-0022");
    expect(parseClientCode("kadix-9999", "KADIX")).toBe("KADIX-9999");
    expect(parseClientCode("DIX-2222", "KADIX")).toBeNull();
  });

  it("keeps branches separate: an explicit code of one branch never resolves for the other", () => {
    // DIX-**** must never be accepted for Кант (KADIX)
    expect(parseClientCode("DIX-2222", "KADIX")).toBeNull();
    expect(parseClientCode("DIX2222", "KADIX")).toBeNull();
    expect(parseClientCode("DIX 2222", "KADIX")).toBeNull();
    expect(parseClientCode("dix-0007", "KADIX")).toBeNull();
    // KADIX-**** must never be accepted for Бишкек (DIX)
    expect(parseClientCode("KADIX-2222", "DIX")).toBeNull();
    expect(parseClientCode("KADIX2222", "DIX")).toBeNull();
    expect(parseClientCode("KADIX 2222", "DIX")).toBeNull();
    expect(parseClientCode("kadix-0007", "DIX")).toBeNull();
    // а это как раз строки KADIX из тестового файла Бишкека — должны отсеиваться
    expect(parseClientCode("KADIX0007", "DIX")).toBeNull();
    expect(parseClientCode("KADIX0011", "DIX")).toBeNull();
    expect(parseClientCode("KADIX0014", "DIX")).toBeNull();
  });
});
