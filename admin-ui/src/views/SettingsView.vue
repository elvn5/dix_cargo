<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";

pageTitle.value = "Настройки бота";

// tariff_per_kg приходит из <input type="number">, поэтому Vue хранит его как число
const form = reactive<{
  tariff_per_kg: string | number;
  forbidden_items: string;
  support_text: string;
  addresses_text: string;
}>({
  tariff_per_kg: "",
  forbidden_items: "",
  support_text: "",
  addresses_text: "",
});

const managers = ref<{ name: string; url: string }[]>([]);
const saved = ref(false);
const submitting = ref(false);
const loading = ref(true);

// ── Алерты бэкапа ──────────────────────────────────────────────────────────
const alertChatId = ref("");
const alertMsg = ref<{ kind: "success" | "danger"; text: string } | null>(null);
const alertBusy = ref(false);

function alertError(e: unknown): string {
  if (e instanceof ApiError && e.message === "invalid_chat_id") return "Chat ID — это число, например 434413828 или -1001234567890.";
  if (e instanceof ApiError && e.message === "send_failed") {
    return `Telegram не принял сообщение: ${String(e.data?.description ?? "")}. Напишите боту /start с этого аккаунта и попробуйте снова.`;
  }
  return "Не удалось выполнить запрос.";
}

async function saveAlertChat() {
  alertBusy.value = true;
  alertMsg.value = null;
  try {
    await api.put("/admin/settings", { backup_alert_chat_id: alertChatId.value.trim() });
    alertMsg.value = { kind: "success", text: alertChatId.value.trim() ? "Chat ID сохранён." : "Алерты выключены." };
  } catch (e) {
    alertMsg.value = { kind: "danger", text: alertError(e) };
  } finally {
    alertBusy.value = false;
  }
}

async function testAlertChat() {
  alertBusy.value = true;
  alertMsg.value = null;
  try {
    await api.post("/admin/settings/test-alert", { chat_id: alertChatId.value.trim() });
    alertMsg.value = { kind: "success", text: "Тестовое сообщение отправлено — проверьте Telegram." };
  } catch (e) {
    alertMsg.value = { kind: "danger", text: alertError(e) };
  } finally {
    alertBusy.value = false;
  }
}

async function load() {
  const data = await api.get<{
    settings: Record<string, string>;
    managers: { name: string; url: string }[];
    backupAlertChatId?: string;
  }>("/admin/settings");
  alertChatId.value = data.backupAlertChatId ?? "";
  form.tariff_per_kg = data.settings.tariff_per_kg ?? "";
  form.forbidden_items = data.settings.forbidden_items ?? "";
  form.support_text = data.settings.support_text ?? "";
  form.addresses_text = data.settings.addresses_text ?? "";
  managers.value = data.managers.length ? data.managers.map(m => ({ ...m })) : [{ name: "", url: "" }];
  loading.value = false;
}

function addManager() {
  managers.value.push({ name: "", url: "" });
}

function removeManager(index: number) {
  managers.value.splice(index, 1);
}

async function save() {
  submitting.value = true;
  try {
    await api.put("/admin/settings", {
      ...form,
      tariff_per_kg: String(form.tariff_per_kg ?? "").trim(),
      managers: managers.value,
    });
    saved.value = true;
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="saved" class="alert alert-success">Изменения сохранены.</div>
  <LoadingSpinner v-if="loading" />
  <div v-else class="max-w-3xl space-y-4">
    <div class="card p-6">
      <form class="space-y-6" @submit.prevent="save">
        <div>
          <h2 class="font-bold mb-3">💰 Тариф</h2>
          <div class="max-w-xs">
            <label class="field-label">Стоимость за кг (сом)</label>
            <input v-model="form.tariff_per_kg" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
            <div class="field-hint">Цена посылки = вес × тариф</div>
          </div>
        </div>

        <hr class="border-slate-200" />

        <div>
          <h2 class="font-bold mb-3">👥 Кнопки менеджеров</h2>
          <div class="space-y-3">
            <div
              v-for="(manager, index) in managers"
              :key="index"
              class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 sm:items-end"
            >
              <div>
                <label class="field-label">Имя</label>
                <input v-model="manager.name" class="input" placeholder="Имя менеджера" />
              </div>
              <div>
                <label class="field-label">Ссылка</label>
                <input v-model="manager.url" type="url" class="input" placeholder="https://wa.me/..." />
              </div>
              <button
                type="button"
                class="btn btn-outline"
                data-test="remove-manager"
                :disabled="managers.length <= 1"
                @click="removeManager(index)"
              >
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <button type="button" class="btn btn-outline mt-3" data-test="add-manager" @click="addManager">
            <i class="bi bi-plus-lg"></i> Добавить менеджера
          </button>
        </div>

        <hr class="border-slate-200" />

        <div>
          <h2 class="font-bold mb-3">💬 Сообщение «Поддержка»</h2>
          <label class="text-xs text-slate-400 mb-1 block">
            Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;a href="..."&gt;). Кнопки менеджеров и соцсетей добавляются автоматически.
          </label>
          <textarea
            v-model="form.support_text"
            class="textarea font-mono"
            rows="8"
            data-test="support-text"
            required
          ></textarea>
        </div>

        <hr class="border-slate-200" />

        <div>
          <h2 class="font-bold mb-3">📍 Сообщение «Адреса»</h2>
          <label class="text-xs text-slate-400 mb-1 block">
            Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;a href="..."&gt;). Кнопки маркетплейсов добавляются автоматически.
          </label>
          <textarea
            v-model="form.addresses_text"
            class="textarea font-mono"
            rows="8"
            data-test="addresses-text"
            required
          ></textarea>
        </div>

        <hr class="border-slate-200" />

        <div>
          <h2 class="font-bold mb-3">🚫 Запрещённые товары</h2>
          <label class="text-xs text-slate-400 mb-1 block">Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;code&gt;)</label>
          <textarea
            v-model="form.forbidden_items"
            class="textarea font-mono"
            rows="18"
            data-test="forbidden-items"
            required
          ></textarea>
        </div>

        <button class="btn btn-primary" :disabled="submitting">
          <i class="bi bi-check-lg"></i> Сохранить
        </button>
      </form>
    </div>

    <div class="card p-6" data-test="alert-settings">
      <h2 class="font-bold mb-1">🔔 Алерты бэкапа</h2>
      <p class="text-sm text-slate-500 mb-3">
        Если ежедневный бэкап базы в Google Drive не удастся, бот пришлёт сообщение в этот чат.
        Настройка общая для всех филиалов. Узнать свой chat ID: отправьте боту команду <code>/chatid</code>
        или найдите себя в разделе «Пользователи».
      </p>
      <div v-if="alertMsg" class="alert" :class="alertMsg.kind === 'success' ? 'alert-success' : 'alert-danger'" data-test="alert-msg">
        {{ alertMsg.text }}
      </div>
      <div class="flex flex-wrap gap-2 items-end">
        <div class="w-64">
          <label class="field-label">Telegram chat ID</label>
          <input v-model="alertChatId" class="input font-mono" placeholder="434413828" inputmode="numeric" data-test="alert-chat-id" />
        </div>
        <button type="button" class="btn btn-primary" :disabled="alertBusy" data-test="alert-save" @click="saveAlertChat">
          <i class="bi bi-check-lg"></i> Сохранить
        </button>
        <button
          type="button"
          class="btn btn-outline"
          :disabled="alertBusy || !alertChatId.trim()"
          data-test="alert-test"
          @click="testAlertChat"
        >
          <i class="bi bi-send"></i> Отправить тест
        </button>
      </div>
      <div class="field-hint">Пустое поле — алерты выключены.</div>
    </div>

    <div class="card p-6">
      <h2 class="font-bold mb-3">🗄 База данных</h2>
      <p class="text-sm text-slate-500 mb-3">Полный SQL-дамп текущей базы данных.</p>
      <a href="/api/admin/db-dump" class="btn btn-outline">
        <i class="bi bi-download"></i> Скачать дамп базы данных
      </a>
    </div>
  </div>
</template>
