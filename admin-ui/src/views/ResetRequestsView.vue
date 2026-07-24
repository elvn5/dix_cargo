<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";

pageTitle.value = "Заявки на сброс доступа";

interface ResetRequest {
  id: number;
  requested_telegram_id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
  resolved_at: string | null;
  user: { id: number; client_code: string; full_name: string; phone: string; telegram_id: string };
}

const STATUS_LABEL: Record<string, string> = { PENDING: "Ожидает", APPROVED: "Одобрено", REJECTED: "Отклонено" };
const STATUS_BADGE: Record<string, string> = { PENDING: "badge-warning", APPROVED: "badge-success", REJECTED: "badge-danger" };

const requests = ref<ResetRequest[]>([]);
const loading = ref(true);
const processingId = ref<number | null>(null);

async function load() {
  const data = await api.get<{ requests: ResetRequest[] }>("/admin/reset-requests");
  requests.value = data.requests;
  loading.value = false;
}

async function approve(r: ResetRequest) {
  if (!confirm(`Одобрить сброс доступа для ${r.user.client_code}?\n\nАккаунт будет привязан к новому Telegram ID вместо текущего.`)) return;
  processingId.value = r.id;
  try {
    await api.post(`/admin/reset-requests/${r.id}/approve`);
    await load();
  } finally {
    processingId.value = null;
  }
}

async function reject(r: ResetRequest) {
  if (!confirm(`Отклонить заявку на сброс доступа для ${r.user.client_code}?`)) return;
  processingId.value = r.id;
  try {
    await api.post(`/admin/reset-requests/${r.id}/reject`);
    await load();
  } finally {
    processingId.value = null;
  }
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}

onMounted(load);
</script>

<template>
  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Клиент</th><th>Текущий Telegram ID</th><th>Запрошенный Telegram ID</th>
            <th>Статус</th><th>Дата заявки</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6"><LoadingSpinner compact label="" /></td>
          </tr>
          <tr v-else-if="requests.length === 0">
            <td colspan="6" class="text-center text-slate-400 py-8">Заявок нет</td>
          </tr>
          <tr v-for="r in requests" :key="r.id">
            <td>
              <router-link :to="`/users/${r.user.id}`" class="text-indigo-600 hover:underline">{{ r.user.client_code }}</router-link>
              <div class="text-sm text-slate-500">{{ r.user.full_name }}</div>
            </td>
            <td class="font-mono text-sm">{{ r.user.telegram_id }}</td>
            <td class="font-mono text-sm">{{ r.requested_telegram_id }}</td>
            <td><span class="badge" :class="STATUS_BADGE[r.status]">{{ STATUS_LABEL[r.status] }}</span></td>
            <td class="text-slate-400 text-xs">{{ fmtDate(r.created_at) }}</td>
            <td>
              <div v-if="r.status === 'PENDING'" class="flex gap-2">
                <button class="btn btn-outline-success btn-sm" :disabled="processingId === r.id" @click="approve(r)">
                  <i class="bi bi-check-lg"></i> Одобрить
                </button>
                <button class="btn btn-outline-danger btn-sm" :disabled="processingId === r.id" @click="reject(r)">
                  <i class="bi bi-x-lg"></i> Отклонить
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
