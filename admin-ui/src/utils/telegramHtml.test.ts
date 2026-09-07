import { describe, it, expect } from "vitest";
import { serializeTelegramHtml, telegramTextLength, telegramHtmlToPreview } from "./telegramHtml";

function ser(innerHtml: string): string {
  const d = document.createElement("div");
  d.innerHTML = innerHtml;
  return serializeTelegramHtml(d);
}

function serText(text: string): string {
  const d = document.createElement("div");
  d.textContent = text;
  return serializeTelegramHtml(d);
}

describe("serializeTelegramHtml", () => {
  it("escapes special characters in text", () => {
    expect(serText("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("keeps supported formatting tags", () => {
    expect(ser("<b>hi</b>")).toBe("<b>hi</b>");
    expect(ser("<i>x</i>")).toBe("<i>x</i>");
    expect(ser("<u>x</u>")).toBe("<u>x</u>");
    expect(ser("<code>x</code>")).toBe("<code>x</code>");
  });

  it("normalizes tag aliases produced by execCommand", () => {
    expect(ser("<strong>a</strong>")).toBe("<b>a</b>");
    expect(ser("<em>a</em>")).toBe("<i>a</i>");
    expect(ser("<strike>a</strike>")).toBe("<s>a</s>");
  });

  it("turns block elements and <br> into newlines", () => {
    expect(ser("a<div>b</div><div>c</div>")).toBe("a\nb\nc");
    expect(ser("a<br>b")).toBe("a\nb");
  });

  it("collapses extra blank lines and trims", () => {
    expect(ser("a<div><br></div><div><br></div><div>b</div>")).toBe("a\n\nb");
  });

  it("keeps valid links and unwraps invalid ones", () => {
    expect(ser('<a href="https://x.io">go</a>')).toBe('<a href="https://x.io">go</a>');
    expect(ser('<a href="ftp://x">go</a>')).toBe("go");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(ser('<span style="color:red">y</span>')).toBe("y");
  });

  it("keeps a tg-spoiler span", () => {
    expect(ser('<span class="tg-spoiler">s</span>')).toBe('<span class="tg-spoiler">s</span>');
  });
});

describe("telegramTextLength", () => {
  it("counts visible characters only", () => {
    expect(telegramTextLength("<b>abc</b>")).toBe(3);
    expect(telegramTextLength("a &amp; b")).toBe("a & b".length);
  });
});

describe("telegramHtmlToPreview", () => {
  it("converts newlines to <br>", () => {
    expect(telegramHtmlToPreview("a\nb")).toBe("a<br>b");
  });
});
