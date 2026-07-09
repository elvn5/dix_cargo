<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";

pageTitle.value = "Промокоды";

interface Promo {
  id: number;
  code: string;
  description: string | null;
  claimed_at: string | null;
  claimer: { id: number; client_code: string; full_name: string } | null;
}

const promos = ref<Promo[]>([]);
const code = ref("");
const description = ref("");
const submitting = ref(false);
const loading = ref(true);

async function load() {
  const data = await api.get<{ promos: Promo[] }>("/admin/promocodes");
  promos.value = data.promos;
  loading.value = false;
}

async function create() {
  submitting.value = true;
  try {
    await api.post("/admin/promocodes", { code: code.value, description: description.value });
    code.value = "";
    description.value = "";
    await load();
  } finally {
    submitting.value = false;
  }
}

async function remove(p: Promo) {
  if (!confirm("Удалить промокод?")) return;
  await api.delete(`/admin/promocodes/${p.id}`);
  await load();
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}

onMounted(load);
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div>
      <div class="card p-6">
        <h2 class="font-bold mb-4">➕ Новый промокод</h2>
        <form class="space-y-4" @submit.prevent="create">
          <div>
            <label class="field-label">Код</label>
            <input v-model="code" class="input font-mono" required placeholder="SUMMER25" />
          </div>
          <div>
            <label class="field-label">Описание <span class="text-slate-400 font-normal">(необязательно)</span></label>
            <input v-model="description" class="input" placeholder="Скидка 10% на следующий заказ" />
          </div>
          <button class="btn btn-primary w-full" :disabled="submitting">
            <i class="bi bi-plus-lg"></i> Создать
          </button>
        </form>
      </div>
    </div>
    <div class="lg:col-span-2">
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Код</th><th>Описание</th><th>Статус / Клиент</th><th>Получен</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-if="loading">
                <td colspan="5"><LoadingSpinner compact label="" /></td>
              </tr>
              <tr v-else-if="promos.length === 0">
                <td colspan="5" class="text-center text-slate-400 py-8">Промокодов нет</td>
              </tr>
              <tr v-for="p in promos" :key="p.id">
                <td><code>{{ p.code }}</code></td>
                <td>{{ p.description ?? "—" }}</td>
                <td>
                  <template v-if="p.claimer">
                    <router-link :to="`/users/${p.claimer.id}`" class="text-indigo-600 hover:underline">{{ p.claimer.client_code }}</router-link>
                    {{ p.claimer.full_name }}
                  </template>
                  <span v-else class="badge badge-success">Активен</span>
                </td>
                <td>{{ p.claimed_at ? fmtDate(p.claimed_at) : "—" }}</td>
                <td>
                  <button class="btn btn-outline-danger btn-sm" @click="remove(p)"><i class="bi bi-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
