<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Импорт посылок из Excel";

const codePrefix = ref("DIX");
const file = ref<File | null>(null);
const result = ref<{ imported: number; skipped: number; errors: string[] } | null>(null);
const submitting = ref(false);

onMounted(async () => {
  const meta = await api.get<{ codePrefix: string }>("/admin/meta");
  codePrefix.value = meta.codePrefix;
});

function onFileChange(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function submit() {
  if (!file.value) return;
  submitting.value = true;
  const form = new FormData();
  form.append("file", file.value);
  try {
    result.value = await api.post("/admin/packages/import", form);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="result">
    <div class="alert alert-success">
      Импортировано: <b>{{ result.imported }}</b> посылок. Пропущено: {{ result.skipped }}.
      <div v-if="result.errors.length" class="text-xs text-slate-500 mt-2 space-y-0.5">
        <div v-for="(err, i) in result.errors.slice(0, 10)" :key="i">{{ err }}</div>
      </div>
    </div>
    <router-link to="/packages" class="btn btn-primary">К списку посылок</router-link>
  </div>
  <div v-else class="max-w-xl">
    <div class="card p-6">
      <p class="text-sm text-slate-500 mb-4">
        Колонка <b>C</b> — код клиента. Форматы:
        <code>2222</code>, <code>{{ codePrefix }}2222</code>, <code>{{ codePrefix }}-2222</code>, <code>{{ codePrefix }} 2222</code>.<br />
        Колонка <b>D</b> — трек-номер.<br />
        Строки без распознанного кода в колонке C пропускаются.<br />
        Дата отправки извлекается из имени файла (формат: <code>4月18号…</code>).<br />
        Если дата не найдена — используется сегодняшняя.
      </p>
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="field-label">Excel файл (.xlsx)</label>
          <input type="file" accept=".xlsx" class="input" required @change="onFileChange" />
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" :disabled="submitting">
            <i class="bi bi-upload"></i> Импортировать
          </button>
          <router-link to="/packages" class="btn btn-outline">Отмена</router-link>
        </div>
      </form>
    </div>
  </div>
</template>
