<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Импорт посылок из Excel";

type PlanItem = {
  clientCode: string;
  trackCode: string;
  userName: string | null;
  action: "import" | "skip";
  reason?: "user_not_found" | "duplicate";
};

type ImportResponse = {
  dryRun: boolean;
  imported: number;
  skipped: number;
  shippingDate: string;
  toImport: number;
  toSkip: number;
  unrecognized: number;
  items: PlanItem[];
  itemsTruncated: boolean;
  errors: string[];
};

const codePrefix = ref("DIX");
const file = ref<File | null>(null);
const preview = ref<ImportResponse | null>(null);
const result = ref<ImportResponse | null>(null);
const submitting = ref(false);
const confirming = ref(false);

onMounted(async () => {
  const meta = await api.get<{ codePrefix: string }>("/admin/meta");
  codePrefix.value = meta.codePrefix;
});

function onFileChange(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("ru-RU");
}

const REASON_LABEL: Record<string, string> = {
  user_not_found: "клиент не найден",
  duplicate: "уже есть (дубликат)",
};

// Шаг 1 — построить превью изменений (без записи в БД).
async function buildPreview() {
  if (!file.value) return;
  submitting.value = true;
  const form = new FormData();
  form.append("file", file.value);
  try {
    preview.value = await api.post<ImportResponse>("/admin/packages/import?dryRun=1", form);
  } finally {
    submitting.value = false;
  }
}

// Шаг 2 — применить импорт (повторно отправляем тот же файл).
async function confirmImport() {
  if (!file.value) return;
  confirming.value = true;
  const form = new FormData();
  form.append("file", file.value);
  try {
    result.value = await api.post<ImportResponse>("/admin/packages/import", form);
    preview.value = null;
  } finally {
    confirming.value = false;
  }
}

// Отмена превью — ничего не импортируем, возвращаемся к форме.
function cancelPreview() {
  preview.value = null;
}

const hasPreview = computed(() => preview.value !== null);
</script>

<template>
  <!-- Результат импорта -->
  <div v-if="result">
    <div class="alert alert-success">
      Импортировано: <b>{{ result.imported }}</b> посылок. Пропущено: {{ result.skipped }}.
      <div v-if="result.errors.length" class="text-xs text-slate-500 mt-2 space-y-0.5">
        <div v-for="(err, i) in result.errors.slice(0, 10)" :key="i">{{ err }}</div>
      </div>
    </div>
    <router-link to="/packages" class="btn btn-primary">К списку посылок</router-link>
  </div>

  <!-- Превью вносимых изменений -->
  <div v-else-if="hasPreview && preview">
    <div class="card p-6 mb-4">
      <h2 class="text-base font-semibold mb-2">Предпросмотр изменений</h2>
      <p class="text-sm text-slate-500">
        Дата отправки: <b>{{ fmtDate(preview.shippingDate) }}</b>.
        Будет добавлено: <b class="text-emerald-600">{{ preview.toImport }}</b>,
        пропущено: <b class="text-amber-600">{{ preview.toSkip }}</b>.
        <template v-if="preview.unrecognized">
          Строк без распознанного кода: {{ preview.unrecognized }}.
        </template>
      </p>
      <p v-if="preview.toImport === 0" class="text-sm text-amber-600 mt-2">
        Нечего импортировать — новых посылок не найдено.
      </p>
    </div>

    <div class="card mb-4">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Код клиента</th>
              <th>Клиент</th>
              <th>Трек-код</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="preview.items.length === 0">
              <td colspan="4" class="text-center text-slate-400 py-8">Нет строк для импорта</td>
            </tr>
            <tr v-for="(it, i) in preview.items" :key="i">
              <td><span class="badge-code">{{ it.clientCode }}</span></td>
              <td class="text-sm text-slate-500">{{ it.userName || "—" }}</td>
              <td class="font-mono">{{ it.trackCode }}</td>
              <td>
                <span v-if="it.action === 'import'" class="badge badge-success">Добавить</span>
                <span v-else class="badge badge-warning">
                  Пропуск<template v-if="it.reason">: {{ REASON_LABEL[it.reason] }}</template>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="preview.itemsTruncated" class="card-footer text-xs text-slate-400">
        Показаны первые {{ preview.items.length }} строк.
      </div>
    </div>

    <div class="flex gap-2">
      <button
        class="btn btn-primary"
        :disabled="confirming || preview.toImport === 0"
        @click="confirmImport"
      >
        <i class="bi bi-check-lg"></i> Подтвердить импорт ({{ preview.toImport }})
      </button>
      <button type="button" class="btn btn-outline" :disabled="confirming" @click="cancelPreview">
        Отмена
      </button>
    </div>
  </div>

  <!-- Форма выбора файла -->
  <div v-else class="max-w-xl">
    <div class="card p-6">
      <p class="text-sm text-slate-500 mb-4">
        Колонка <b>C</b> — код клиента. Форматы:
        <code>{{ codePrefix }}2222</code>, <code>{{ codePrefix }}-2222</code>, <code>{{ codePrefix }} 2222</code>.<br />
        Колонка <b>D</b> — трек-номер.<br />
        Строки без распознанного кода в колонке C пропускаются.<br />
        Дата отправки извлекается из имени файла (формат: <code>4月18号…</code>).<br />
        Если дата не найдена — используется сегодняшняя.<br />
        После нажатия «Импортировать» откроется предпросмотр — ничего не запишется до подтверждения.
      </p>
      <form class="space-y-4" @submit.prevent="buildPreview">
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
