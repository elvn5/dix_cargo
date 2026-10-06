<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";

pageTitle.value = "Корзина";

interface TrashedUser {
  id: number;
  client_code: string;
  full_name: string;
  phone: string;
  deleted_at: string;
  packages_count: number;
}

const users = ref<TrashedUser[]>([]);
const loading = ref(true);
const message = ref("");

async function load() {
  const data = await api.get<{ users: TrashedUser[] }>("/admin/trash");
  users.value = data.users;
  loading.value = false;
}

async function restore(u: TrashedUser) {
  await api.post(`/admin/trash/${u.id}/restore`);
  message.value = `${u.client_code} ${u.full_name} восстановлен вместе с посылками.`;
  await load();
}

async function purge(u: TrashedUser) {
  const ok = confirm(
    `Удалить НАВСЕГДА ${u.client_code} ${u.full_name} и все его посылки (${u.packages_count})?\n\n` +
      "Это действие нельзя отменить.",
  );
  if (!ok) return;
  await api.delete(`/admin/trash/${u.id}`);
  message.value = `${u.client_code} удалён окончательно.`;
  await load();
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}

onMounted(load);
</script>

<template>
  <div v-if="message" class="alert alert-success">{{ message }}</div>
  <div class="card">
    <div class="card-header">
      <span class="font-semibold">Удалённые клиенты <span class="badge badge-neutral">{{ users.length }}</span></span>
      <div class="text-xs text-slate-400 mt-1">
        Клиенты в корзине и их посылки скрыты из списков, выдачи и бота. Их коды не выдаются новым клиентам.
      </div>
    </div>
    <LoadingSpinner v-if="loading" />
    <div v-else-if="users.length === 0" class="p-8 text-center text-slate-400" data-test="trash-empty">Корзина пуста</div>
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Код</th><th>Клиент</th><th>Телефон</th><th>Посылок</th><th>Удалён</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" data-test="trash-row">
            <td><span class="badge-code">{{ u.client_code }}</span></td>
            <td>
              <router-link :to="`/users/${u.id}`" class="hover:underline">{{ u.full_name }}</router-link>
            </td>
            <td class="text-slate-500">{{ u.phone }}</td>
            <td>{{ u.packages_count }}</td>
            <td class="text-slate-400 text-xs">{{ fmtDateTime(u.deleted_at) }}</td>
            <td class="whitespace-nowrap text-right">
              <button class="btn btn-primary btn-sm" data-test="restore" @click="restore(u)">
                <i class="bi bi-arrow-counterclockwise"></i> Восстановить
              </button>
              <button class="btn btn-outline-danger btn-sm ml-2" title="Удалить навсегда" data-test="purge" @click="purge(u)">
                <i class="bi bi-x-octagon"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
