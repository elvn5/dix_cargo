<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Посылки";

interface PackageRow {
  id: number;
  track_code: string;
  status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
  created_at: string;
  user: { client_code: string; full_name: string };
}

const STATUS_LABEL: Record<string, string> = { IN_OFFICE: "🏢 В офисе", IN_TRANSIT: "🚚 В пути", DELIVERED: "✅ Выдан" };
const STATUS_BADGE: Record<string, string> = { IN_OFFICE: "badge-warning", IN_TRANSIT: "badge-primary", DELIVERED: "badge-success" };

const route = useRoute();
const router = useRouter();

const tab = ref((route.query.tab as string) === "archive" ? "archive" : "active");
const search = ref((route.query.search as string) || "");
const status = ref((route.query.status as string) || "");
const dateFrom = ref((route.query.date_from as string) || "");
const dateTo = ref((route.query.date_to as string) || "");
const page = ref(Number(route.query.page) || 1);

const packages = ref<PackageRow[]>([]);
const total = ref(0);
const totalPages = ref(1);
const activeCount = ref(0);
const archiveCount = ref(0);

function currentQuery() {
  const q: Record<string, string> = { tab: tab.value, page: String(page.value) };
  if (search.value) q.search = search.value;
  if (status.value) q.status = status.value;
  if (dateFrom.value) q.date_from = dateFrom.value;
  if (dateTo.value) q.date_to = dateTo.value;
  return q;
}

async function load() {
  const params = new URLSearchParams(currentQuery());
  const data = await api.get<{
    packages: PackageRow[]; total: number; totalPages: number; activeCount: number; archiveCount: number;
  }>(`/admin/packages?${params}`);
  packages.value = data.packages;
  total.value = data.total;
  totalPages.value = data.totalPages;
  activeCount.value = data.activeCount;
  archiveCount.value = data.archiveCount;
}

function applyFilters() {
  page.value = 1;
  router.replace({ query: currentQuery() });
}

function resetFilters() {
  search.value = "";
  status.value = "";
  dateFrom.value = "";
  dateTo.value = "";
  page.value = 1;
  router.replace({ query: { tab: tab.value } });
}

function switchTab(t: "active" | "archive") {
  tab.value = t;
  status.value = "";
  page.value = 1;
  router.replace({ query: { tab: t } });
}

function goToPage(p: number) {
  page.value = p;
  router.replace({ query: currentQuery() });
}

function exportUrl() {
  const params = new URLSearchParams({
    tab: tab.value, search: search.value, status: status.value, date_from: dateFrom.value, date_to: dateTo.value,
  });
  return `/api/admin/packages/export?${params}`;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}

watch([page, () => route.query], load);
onMounted(load);
</script>

<template>
  <div class="flex gap-1 border-b border-slate-200 mb-4">
    <a href="#" class="tab-link" :class="{ 'tab-link-active': tab === 'active' }" @click.prevent="switchTab('active')">
      📦 Активные <span class="badge ml-1" :class="tab === 'active' ? 'badge-primary' : 'badge-neutral'">{{ activeCount }}</span>
    </a>
    <a href="#" class="tab-link" :class="{ 'tab-link-active': tab === 'archive' }" @click.prevent="switchTab('archive')">
      🗂 Архив <span class="badge ml-1" :class="tab === 'archive' ? 'badge-primary' : 'badge-neutral'">{{ archiveCount }}</span>
    </a>
  </div>

  <div class="flex flex-wrap gap-2 items-center justify-between mb-4">
    <span class="text-slate-500 text-sm">{{ total }} посылок</span>
    <div class="flex gap-2 flex-wrap">
      <router-link to="/packages/import" class="btn btn-outline-success btn-sm">
        <i class="bi bi-file-earmark-excel"></i> Импорт Excel
      </router-link>
      <a :href="exportUrl()" class="btn btn-outline btn-sm">
        <i class="bi bi-download"></i> Скачать Excel
      </a>
      <router-link v-if="tab === 'active'" to="/packages/new" class="btn btn-primary btn-sm">
        <i class="bi bi-plus-lg"></i> Добавить
      </router-link>
    </div>
  </div>

  <form class="flex flex-wrap gap-2 items-center mb-4" @submit.prevent="applyFilters">
    <input v-model="search" class="input flex-1 min-w-[200px]" placeholder="🔍 Поиск по трек-номеру…" />
    <select v-if="tab === 'active'" v-model="status" class="select w-auto">
      <option value="">Все активные</option>
      <option value="IN_TRANSIT">🚚 В пути</option>
      <option value="IN_OFFICE">🏢 В офисе</option>
    </select>
    <div class="flex items-center gap-2">
      <input v-model="dateFrom" type="date" class="input" title="С даты" />
      <span class="text-slate-400">—</span>
      <input v-model="dateTo" type="date" class="input" title="По дату" />
    </div>
    <button class="btn btn-outline">Найти</button>
    <button type="button" class="btn btn-outline" @click="resetFilters">Сброс</button>
  </form>

  <div class="card">
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Трек-код</th><th>Статус</th><th>DIX-код</th><th>Клиент</th><th>Дата</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-if="packages.length === 0">
            <td colspan="6" class="text-center text-slate-400 py-8">Нет посылок</td>
          </tr>
          <tr v-for="p in packages" :key="p.id">
            <td class="font-mono">{{ p.track_code }}</td>
            <td><span class="badge" :class="STATUS_BADGE[p.status]">{{ STATUS_LABEL[p.status] }}</span></td>
            <td><span class="badge-code">{{ p.user.client_code }}</span></td>
            <td class="text-sm text-slate-500">{{ p.user.full_name }}</td>
            <td class="text-slate-400 text-xs">{{ fmtDate(p.created_at) }}</td>
            <td><router-link :to="`/packages/${p.id}`" class="btn btn-outline btn-sm">Открыть</router-link></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="card-footer flex justify-center gap-1">
      <a href="#" class="page-link" :class="{ 'page-link-disabled': page <= 1 }" @click.prevent="goToPage(page - 1)">‹</a>
      <a
        v-for="p in totalPages"
        :key="p"
        href="#"
        class="page-link"
        :class="{ 'page-link-active': p === page }"
        @click.prevent="goToPage(p)"
      >{{ p }}</a>
      <a href="#" class="page-link" :class="{ 'page-link-disabled': page >= totalPages }" @click.prevent="goToPage(page + 1)">›</a>
    </div>
  </div>
</template>
