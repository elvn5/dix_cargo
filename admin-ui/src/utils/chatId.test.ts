import { describe, it, expect } from "vitest";
import { botChatId } from "./chatId";

describe("botChatId", () => {
  it("returns the telegram id of a client who started the bot", () => {
    expect(botChatId("434413828")).toBe("434413828");
  });

  it("returns null for the placeholder of a client created in the admin", () => {
    expect(botChatId("-1781587673988")).toBeNull();
    expect(botChatId("0")).toBeNull();
    expect(botChatId("")).toBeNull();
    expect(botChatId(undefined)).toBeNull();
  });
});
