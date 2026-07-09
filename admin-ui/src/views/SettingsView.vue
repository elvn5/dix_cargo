<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Настройки бота";

const form = reactive({
  tariff_per_kg: "",
  manager_1_name: "",
  manager_1_url: "",
  manager_2_name: "",
  manager_2_url: "",
  forbidden_items: "",
});

const saved = ref(false);
const submitting = ref(false);

async function load() {
  const data = await api.get<{ settings: Record<string, string> }>("/admin/settings");
  form.tariff_per_kg = data.settings.tariff_per_kg ?? "";
  form.manager_1_name = data.settings.manager_1_name ?? "Лидия";
  form.manager_1_url = data.settings.manager_1_url ?? "https://wa.me/996550867414";
  form.manager_2_name = data.settings.manager_2_name ?? "Виктория";
  form.manager_2_url = data.settings.manager_2_url ?? "https://wa.me/996556969906";
  form.forbidden_items = data.settings.forbidden_items ?? "";
}

async function save() {
  submitting.value = true;
  try {
    await api.put("/admin/settings", form);
    saved.value = true;
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="saved" class="alert alert-success">Изменения сохранены.</div>
  <div class="max-w-3xl space-y-4">
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
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label">Менеджер 1 — имя</label>
              <input v-model="form.manager_1_name" class="input" placeholder="Лидия" />
            </div>
            <div>
              <label class="field-label">Менеджер 1 — ссылка</label>
              <input v-model="form.manager_1_url" type="url" class="input" placeholder="https://wa.me/..." />
            </div>
            <div>
              <label class="field-label">Менеджер 2 — имя</label>
              <input v-model="form.manager_2_name" class="input" placeholder="Виктория" />
            </div>
            <div>
              <label class="field-label">Менеджер 2 — ссылка</label>
              <input v-model="form.manager_2_url" type="url" class="input" placeholder="https://wa.me/..." />
            </div>
          </div>
        </div>

        <hr class="border-slate-200" />

        <div>
          <h2 class="font-bold mb-3">🚫 Запрещённые товары</h2>
          <label class="text-xs text-slate-400 mb-1 block">Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;code&gt;)</label>
          <textarea v-model="form.forbidden_items" class="textarea font-mono" rows="18" required></textarea>
        </div>

        <button class="btn btn-primary" :disabled="submitting">
          <i class="bi bi-check-lg"></i> Сохранить
        </button>
      </form>
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
