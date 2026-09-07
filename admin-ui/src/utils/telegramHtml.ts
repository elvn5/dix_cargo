/**
 * Превращает DOM contenteditable-редактора в Telegram-совместимый HTML
 * (parse_mode=HTML). Мы не «чистим» произвольный HTML, а заново собираем строку,
 * выпуская только теги, которые понимает Telegram, и экранируя весь текст —
 * поэтому результат безопасен независимо от того, что вставили в редактор.
 *
 * Telegram поддерживает: <b> <i> <u> <s> <code> <pre> <a href> <span class="tg-spoiler">.
 * Переносы строк должны быть реальными \n (тег <br> и блочные <div>/<p> не поддерживаются).
 */

const BLOCK_TAGS = new Set(["div", "p", "li", "tr", "blockquote"]);

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

interface Ctx {
  out: string;
}

function appendInner(node: Node): string {
  const ctx: Ctx = { out: "" };
  walk(node, ctx);
  return ctx.out;
}

function walk(node: Node, ctx: Ctx): void {
  node.childNodes.forEach((child) => {
    // Text node
    if (child.nodeType === 3) {
      ctx.out += escapeText(child.textContent ?? "");
      return;
    }
    if (child.nodeType !== 1) return;

    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
      ctx.out += "\n";
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      // Граница блока: перенос строки перед содержимым, если он ещё не стоит.
      if (ctx.out.length > 0 && !ctx.out.endsWith("\n")) ctx.out += "\n";
      if (tag === "blockquote") {
        ctx.out += `<blockquote>${appendInner(el)}</blockquote>`;
      } else {
        walk(el, ctx);
      }
      return;
    }

    switch (tag) {
      case "b":
      case "strong":
        ctx.out += `<b>${appendInner(el)}</b>`;
        break;
      case "i":
      case "em":
        ctx.out += `<i>${appendInner(el)}</i>`;
        break;
      case "u":
      case "ins":
        ctx.out += `<u>${appendInner(el)}</u>`;
        break;
      case "s":
      case "strike":
      case "del":
        ctx.out += `<s>${appendInner(el)}</s>`;
        break;
      case "code":
        ctx.out += `<code>${appendInner(el)}</code>`;
        break;
      case "pre":
        ctx.out += `<pre>${appendInner(el)}</pre>`;
        break;
      case "a": {
        const href = el.getAttribute("href") ?? "";
        if (/^(https?:|tg:)/i.test(href.trim())) {
          ctx.out += `<a href="${escapeAttr(href.trim())}">${appendInner(el)}</a>`;
        } else {
          ctx.out += appendInner(el);
        }
        break;
      }
      case "span": {
        if (el.classList.contains("tg-spoiler")) {
          ctx.out += `<span class="tg-spoiler">${appendInner(el)}</span>`;
        } else {
          walk(el, ctx);
        }
        break;
      }
      default:
        // Незнакомый тег — разворачиваем, оставляя только его содержимое.
        walk(el, ctx);
    }
  });
}

/** Сериализует содержимое элемента редактора в Telegram HTML. */
export function serializeTelegramHtml(root: Node): string {
  const ctx: Ctx = { out: "" };
  walk(root, ctx);
  // Схлопываем лишние пустые строки и убираем пробелы/переносы по краям.
  return ctx.out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** Длина видимого текста (без тегов, с раскодированными сущностями) — для лимитов Telegram. */
export function telegramTextLength(html: string): number {
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  return [...text].length;
}

/** Рендер Telegram HTML в безопасный HTML для превью (переносы строк → <br>). */
export function telegramHtmlToPreview(html: string): string {
  return html.replace(/\n/g, "<br>");
}
