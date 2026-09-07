<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import RichMessageEditor from "../components/RichMessageEditor.vue";
import { telegramHtmlToPreview, telegramTextLength } from "../utils/telegramHtml";

pageTitle.value = "Отправить сообщение";

const TG_LIMIT = 4096;

const editorRef = ref<InstanceType<typeof RichMessageEditor> | null>(null);

const html = ref("");
const textLength = ref(0);

const audience = ref<number | null>(null);
const files = ref<{ file: File; url: string | null }[]>([]);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const sending = ref(false);
const result = ref<{ total: number; sent: number; failed: number } | null>(null);
const errorMsg = ref("");

const tgLength = computed(() => telegramTextLength(html.value));
const overLimit = computed(() => tgLength.value > TG_LIMIT);
const hasContent = computed(() => tgLength.value > 0 || files.value.length > 0);
const canSend = computed(() => hasContent.value && !overLimit.value && !sending.value);
const previewHtml = computed(() => telegramHtmlToPreview(html.value));

function onEditorChange(payload: { html: string; length: number }) {
  html.value = payload.html;
  textLength.value = payload.length;
  result.value = null;
}

async function loadAudience() {
  try {
    const data = await api.get<{ count: number }>("/admin/broadcast/audience");
    audience.value = data.count;
  } catch {
    audience.value = null;
  }
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function addFiles(list: FileList | null) {
  if (!list) return;
  for (const file of Array.from(list)) {
    const dup = files.value.some((f) => f.file.name === file.name && f.file.size === file.size);
    if (dup) continue;
    files.value.push({ file, url: isImage(file) ? URL.createObjectURL(file) : null });
  }
  result.value = null;
}

function onFileInput(e: Event) {
  addFiles((e.target as HTMLInputElement).files);
  if (fileInput.value) fileInput.value.value = "";
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  addFiles(e.dataTransfer?.files ?? null);
}

function removeFile(index: number) {
  const entry = files.value[index];
  if (entry?.url) URL.revokeObjectURL(entry.url);
  files.value.splice(index, 1);
  result.value = null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

async function send() {
  if (!canSend.value) return;
  const count = audience.value;
  const question = count != null
    ? `Отправить сообщение ${count} пользователям бота?`
    : "Отправить сообщение всем пользователям бота?";
  if (!window.confirm(question)) return;

  sending.value = true;
  errorMsg.value = "";
  result.value = null;
  try {
    const fd = new FormData();
    fd.append("text", html.value);
    for (const entry of files.value) fd.append("files", entry.file);
    const res = await api.post<{ total: number; sent: number; failed: number }>("/admin/broadcast", fd);
    // Успешно — очищаем форму. reset() редактора эмитит change (обнуляя result),
    // поэтому итог выставляем последним.
    editorRef.value?.reset();
    for (const entry of files.value) if (entry.url) URL.revokeObjectURL(entry.url);
    files.value = [];
    result.value = res;
  } catch (e) {
    errorMsg.value =
      e instanceof ApiError && e.status === 400
        ? "Сообщение пустое или слишком длинное."
        : "Не удалось выполнить рассылку. Попробуйте ещё раз.";
  } finally {
    sending.value = false;
  }
}

onMounted(loadAudience);
onUnmounted(() => {
  for (const entry of files.value) if (entry.url) URL.revokeObjectURL(entry.url);
});
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <div v-if="result" class="alert alert-success" data-test="result">
      Рассылка завершена: отправлено <b>{{ result.sent }}</b> из <b>{{ result.total }}</b>.
      <span v-if="result.failed > 0">Не доставлено: <b>{{ result.failed }}</b> (пользователь заблокировал бота или не начинал диалог).</span>
    </div>
    <div v-if="errorMsg" class="alert alert-danger" data-test="error">{{ errorMsg }}</div>

    <div class="card p-6 space-y-5">
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="field-label mb-0">Текст сообщения</label>
          <span class="text-xs" :class="overLimit ? 'text-red-600 font-semibold' : 'text-slate-400'">
            {{ tgLength }} / {{ TG_LIMIT }}
          </span>
        </div>
        <RichMessageEditor ref="editorRef" @change="onEditorChange" />
        <div class="field-hint">
          Выделите текст и примените форматирование — жирный, курсив, подчёркнутый, зачёркнутый,
          моноширинный или ссылку.
        </div>
      </div>

      <div>
        <label class="field-label">Файлы и изображения</label>
        <div
          class="file-drop-zone"
          :class="{ 'drag-over': dragOver }"
          @click="fileInput?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop="onDrop"
        >
          <input ref="fileInput" type="file" multiple class="hidden" data-test="file-input" @change="onFileInput" />
          <i class="bi bi-paperclip file-drop-icon"></i>
          <div class="file-drop-text">Нажмите или перетащите файлы</div>
          <div class="file-drop-hint">Изображения, документы и другие файлы (до 50 МБ каждый)</div>
        </div>

        <ul v-if="files.length" class="mt-3 space-y-2" data-test="file-list">
          <li
            v-for="(entry, index) in files"
            :key="index"
            class="flex items-center gap-3 rounded-lg border border-slate-200 p-2"
          >
            <img v-if="entry.url" :src="entry.url" alt="" class="h-10 w-10 rounded object-cover shrink-0" />
            <i v-else class="bi bi-file-earmark text-2xl text-slate-400 w-10 text-center shrink-0"></i>
            <div class="min-w-0 flex-1">
              <div class="text-sm text-slate-700 truncate">{{ entry.file.name }}</div>
              <div class="text-xs text-slate-400">{{ formatSize(entry.file.size) }}</div>
            </div>
            <button
              type="button"
              class="btn btn-outline-danger btn-sm shrink-0"
              data-test="remove-file"
              @click="removeFile(index)"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="tgLength > 0">
        <label class="field-label">Предпросмотр</label>
        <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap break-words" data-test="preview" v-html="previewHtml"></div>
      </div>

      <div class="flex items-center gap-3 pt-1">
        <button class="btn btn-primary" :disabled="!canSend" data-test="send" @click="send">
          <i class="bi" :class="sending ? 'bi-hourglass-split' : 'bi-send'"></i>
          {{ sending ? "Отправка…" : "Отправить" }}
        </button>
        <span v-if="audience != null" class="text-sm text-slate-500" data-test="audience">
          Получат: {{ audience }} польз.
        </span>
        <span v-if="overLimit" class="text-sm text-red-600">Текст превышает лимит Telegram (4096 символов).</span>
      </div>
    </div>
  </div>
</template>
