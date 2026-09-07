<script setup lang="ts">
import { onMounted, ref } from "vue";
import { serializeTelegramHtml } from "../utils/telegramHtml";

const emit = defineEmits<{ (e: "change", payload: { html: string; length: number }): void }>();

const editor = ref<HTMLDivElement | null>(null);

interface ToolButton {
  cmd: string;
  icon: string;
  title: string;
  action: () => void;
}

function focusEditor() {
  editor.value?.focus();
}

function emitChange() {
  if (!editor.value) return;
  const html = serializeTelegramHtml(editor.value);
  const length = editor.value.textContent?.length ?? 0;
  emit("change", { html, length });
}

// execCommand устарел, но остаётся единственным кроссбраузерным способом
// форматирования в contenteditable без сторонних зависимостей.
function exec(command: string) {
  focusEditor();
  try {
    document.execCommand("styleWithCSS", false, "false");
  } catch {
    // Safari бросает на styleWithCSS — не критично, продолжаем.
  }
  document.execCommand(command);
  emitChange();
}

function wrapSelectionInCode() {
  focusEditor();
  const sel = window.getSelection();
  const text = sel?.toString();
  if (!text) return;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  document.execCommand("insertHTML", false, `<code>${escaped}</code>`);
  emitChange();
}

function insertLink() {
  focusEditor();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    window.alert("Сначала выделите текст, который станет ссылкой.");
    return;
  }
  const raw = window.prompt("Введите ссылку (URL):", "https://");
  if (!raw) return;
  const url = /^(https?:|tg:)/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  document.execCommand("createLink", false, url);
  emitChange();
}

function clearFormatting() {
  focusEditor();
  document.execCommand("removeFormat");
  document.execCommand("unlink");
  emitChange();
}

const buttons: ToolButton[] = [
  { cmd: "bold", icon: "bi-type-bold", title: "Жирный", action: () => exec("bold") },
  { cmd: "italic", icon: "bi-type-italic", title: "Курсив", action: () => exec("italic") },
  { cmd: "underline", icon: "bi-type-underline", title: "Подчёркнутый", action: () => exec("underline") },
  { cmd: "strike", icon: "bi-type-strikethrough", title: "Зачёркнутый", action: () => exec("strikeThrough") },
  { cmd: "code", icon: "bi-code", title: "Моноширинный", action: wrapSelectionInCode },
  { cmd: "link", icon: "bi-link-45deg", title: "Ссылка", action: insertLink },
  { cmd: "clear", icon: "bi-eraser", title: "Убрать форматирование", action: clearFormatting },
];

/** Полностью очищает редактор — используется после успешной отправки. */
function reset() {
  if (editor.value) editor.value.innerHTML = "";
  emitChange();
}

defineExpose({ reset });

onMounted(emitChange);
</script>

<template>
  <div class="rich-editor">
    <div class="rich-toolbar" role="toolbar">
      <button
        v-for="b in buttons"
        :key="b.cmd"
        type="button"
        class="rich-tool-btn"
        :title="b.title"
        :aria-label="b.title"
        :data-test="`fmt-${b.cmd}`"
        @mousedown.prevent
        @click="b.action"
      >
        <i class="bi" :class="b.icon"></i>
      </button>
    </div>
    <div
      ref="editor"
      class="rich-content"
      contenteditable="true"
      data-test="editor"
      role="textbox"
      aria-multiline="true"
      @input="emitChange"
      @blur="emitChange"
    ></div>
  </div>
</template>

<style scoped>
.rich-editor {
  border: 1px solid rgb(203 213 225);
  border-radius: 0.5rem;
  overflow: hidden;
  background: #fff;
}
.rich-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.125rem;
  padding: 0.375rem;
  border-bottom: 1px solid rgb(226 232 240);
  background: rgb(248 250 252);
}
.rich-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
  color: rgb(51 65 85);
  cursor: pointer;
  transition: background-color 0.15s;
}
.rich-tool-btn:hover {
  background: rgb(226 232 240);
}
.rich-content {
  min-height: 12rem;
  max-height: 28rem;
  overflow-y: auto;
  padding: 0.75rem;
  font-size: 0.9rem;
  line-height: 1.5;
  outline: none;
}
.rich-content:empty::before {
  content: "Введите текст сообщения…";
  color: rgb(148 163 184);
}
.rich-content :deep(code) {
  background: rgb(241 245 249);
  padding: 0.05rem 0.3rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
}
.rich-content :deep(a) {
  color: rgb(37 99 235);
  text-decoration: underline;
}
</style>
