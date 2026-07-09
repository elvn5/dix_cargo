<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Дашборд";

interface DashboardData {
  totalUsers: number;
  totalPackages: number;
  pkgOffice: number;
  pkgTransit: number;
  pkgDelivered: number;
  period: {
    usersDay: number; usersWeek: number; usersMonth: number; usersYear: number;
    pkgDay: number; pkgWeek: number; pkgMonth: number; pkgYear: number;
  };
  latestUsers: { id: number; client_code: string; full_name: string; phone: string; created_at: string }[];
}

const data = ref<DashboardData | null>(null);
const loading = ref(true);

onMounted(async () => {
  data.value = await api.get<DashboardData>("/admin/dashboard");
  loading.value = false;
});

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}
</script>

<template>
  <div v-if="loading" class="text-slate-400">Загрузка…</div>
  <template v-else-if="data">
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <div class="card p-4">
        <div class="text-slate-500 text-sm mb-1">Всего пользователей</div>
        <div class="text-3xl font-bold text-indigo-600">{{ data.totalUsers }}</div>
      </div>
      <div class="card p-4">
        <div class="text-slate-500 text-sm mb-1">Всего посылок</div>
        <div class="text-3xl font-bold text-emerald-600">{{ data.totalPackages }}</div>
      </div>
      <div class="card p-4">
        <div class="text-slate-500 text-sm mb-1">🏢 В офисе</div>
        <div class="text-3xl font-bold text-amber-600">{{ data.pkgOffice }}</div>
      </div>
      <div class="card p-4">
        <div class="text-slate-500 text-sm mb-1">🚚 В пути</div>
        <div class="text-3xl font-bold text-indigo-600">{{ data.pkgTransit }}</div>
      </div>
      <div class="card p-4">
        <div class="text-slate-500 text-sm mb-1">✅ Выдано</div>
        <div class="text-3xl font-bold text-emerald-600">{{ data.pkgDelivered }}</div>
      </div>
    </div>

    <div class="card mb-6">
      <div class="card-header font-semibold">📊 Статистика за период</div>
      <div class="table-wrap">
        <table class="data-table text-center">
          <thead>
            <tr>
              <th class="text-left!">Метрика</th>
              <th>День</th>
              <th>Неделя</th>
              <th>Месяц</th>
              <th>Год</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="font-semibold text-left!">👤 Новые пользователи</td>
              <td>{{ data.period.usersDay }}</td>
              <td>{{ data.period.usersWeek }}</td>
              <td>{{ data.period.usersMonth }}</td>
              <td>{{ data.period.usersYear }}</td>
            </tr>
            <tr>
              <td class="font-semibold text-left!">📦 Новые посылки</td>
              <td>{{ data.period.pkgDay }}</td>
              <td>{{ data.period.pkgWeek }}</td>
              <td>{{ data.period.pkgMonth }}</td>
              <td>{{ data.period.pkgYear }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header font-semibold">Последние регистрации</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>КОД</th><th>ФИО</th><th>Телефон</th><th>Дата</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-if="data.latestUsers.length === 0">
              <td colspan="5" class="text-center text-slate-400 py-8">Нет данных</td>
            </tr>
            <tr v-for="u in data.latestUsers" :key="u.id">
              <td><span class="badge-code">{{ u.client_code }}</span></td>
              <td>{{ u.full_name }}</td>
              <td>{{ u.phone }}</td>
              <td class="text-slate-400 text-xs">{{ fmtDate(u.created_at) }}</td>
              <td><router-link :to="`/users/${u.id}`" class="btn btn-outline btn-sm">Открыть</router-link></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>
