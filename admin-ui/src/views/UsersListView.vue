<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";

pageTitle.value = "Пользователи";

interface UserRow {
  id: number;
  client_code: string;
  full_name: string;
  phone: string;
  created_at: string;
}

const route = useRoute();
const router = useRouter();

const users = ref<UserRow[]>([]);
const total = ref(0);
const pages = ref(1);
const page = ref(Number(route.query.page) || 1);
const q = ref((route.query.q as string) || "");
const loading = ref(true);

async function load() {
  const params = new URLSearchParams({ page: String(page.value), q: q.value });
  const data = await api.get<{ users: UserRow[]; total: number; pages: number }>(`/admin/users?${params}`);
  users.value = data.users;
  total.value = data.total;
  pages.value = data.pages;
  loading.value = false;
}

function search() {
  page.value = 1;
  router.replace({ query: { page: "1", q: q.value || undefined } });
}

function resetSearch() {
  q.value = "";
  page.value = 1;
  router.replace({ query: {} });
}

function goToPage(p: number) {
  page.value = p;
  router.replace({ query: { page: String(p), q: q.value || undefined } });
}

async function remove(u: UserRow) {
  if (!confirm(`Удалить пользователя ${u.full_name}?`)) return;
  await api.delete(`/admin/users/${u.id}`);
  await load();
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}

watch([page, () => route.query], load);
onMounted(load);
</script>

<template>
  <div class="card">
    <div class="card-header flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="font-semibold">Пользователи <span class="badge badge-neutral">{{ total }}</span></span>
        <router-link to="/users/new" class="btn btn-primary btn-sm">
          <i class="bi bi-plus-lg"></i> Добавить
        </router-link>
      </div>
      <form class="flex gap-2 flex-wrap w-full sm:w-auto" @submit.prevent="search">
        <input v-model="q" class="input min-w-[180px]" placeholder="Поиск по имени, телефону, коду..." />
        <button class="btn btn-outline btn-sm">Найти</button>
        <button v-if="q" type="button" class="btn btn-outline btn-sm" @click="resetSearch">Сброс</button>
      </form>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>КОД</th><th>ФИО</th><th>Телефон</th><th>Дата регистрации</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5"><LoadingSpinner compact label="" /></td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="5" class="text-center text-slate-400 py-8">Нет пользователей</td>
          </tr>
          <tr v-for="u in users" :key="u.id">
            <td><span class="badge-code">{{ u.client_code }}</span></td>
            <td>{{ u.full_name }}</td>
            <td>{{ u.phone }}</td>
            <td class="text-slate-400 text-xs">{{ fmtDate(u.created_at) }}</td>
            <td class="flex gap-1">
              <router-link :to="`/users/${u.id}`" class="btn btn-outline btn-sm"><i class="bi bi-pencil"></i></router-link>
              <button class="btn btn-outline-danger btn-sm" @click="remove(u)"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="pages > 1" class="card-footer flex justify-end gap-1">
      <a
        v-for="p in pages"
        :key="p"
        href="#"
        class="page-link"
        :class="{ 'page-link-active': p === page }"
        @click.prevent="goToPage(p)"
      >{{ p }}</a>
    </div>
  </div>
</template>
