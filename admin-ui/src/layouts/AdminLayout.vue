<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore, type Branch } from "../stores/auth";
import { pageTitle } from "../composables/pageTitle";

const auth = useAuthStore();
const router = useRouter();
const sidebarOpen = ref(false);

const navItems = [
  { to: "/", label: "Дашборд", icon: "bi-speedometer2", exact: true },
  { to: "/users", label: "Пользователи", icon: "bi-people" },
  { to: "/packages", label: "Посылки", icon: "bi-box-seam" },
  { to: "/promocodes", label: "Промокоды", icon: "bi-ticket-perforated" },
  { to: "/reset-requests", label: "Заявки на сброс", icon: "bi-person-lock" },
  { to: "/marketplaces", label: "Маркетплейсы", icon: "bi-shop" },
  { to: "/settings", label: "Настройки бота", icon: "bi-gear" },
];

async function switchBranch(branch: Branch) {
  await auth.setBranch(branch);
  sidebarOpen.value = false;
  window.location.reload();
}

async function logout() {
  await auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <header class="flex md:hidden items-center justify-between px-4 py-3 bg-slate-900">
    <span class="text-white font-bold">
      ✈️ DIX Cargo
      <span v-if="auth.isStaging" class="text-amber-400 text-xs ml-1">Тестовый</span>
    </span>
    <button class="text-white text-2xl leading-none" @click="sidebarOpen = !sidebarOpen">
      <i class="bi bi-list"></i>
    </button>
  </header>

  <div class="flex min-h-screen">
    <nav
      class="w-60 shrink-0 bg-slate-900 flex flex-col fixed md:static inset-y-0 left-0 z-40 transition-transform -translate-x-full md:translate-x-0"
      :class="{ 'translate-x-0': sidebarOpen }"
    >
      <div class="hidden md:block px-4 py-6 border-b border-slate-700">
        <span class="text-white text-xl font-bold">✈️ DIX Cargo</span>
        <div v-if="auth.isStaging" class="text-amber-400 text-sm font-extrabold tracking-wide mt-1">ТЕСТОВЫЙ</div>
      </div>

      <div class="px-4 py-3 border-b border-slate-700">
        <div class="text-white/40 text-[11px] uppercase tracking-wide mb-1.5">🏢 Филиал</div>
        <div class="flex gap-1.5 flex-wrap">
          <button
            v-for="b in auth.branches"
            :key="b.key"
            class="btn btn-sm"
            :class="b.key === auth.branch ? 'btn-light' : 'btn-outline-light'"
            :disabled="b.key === auth.branch"
            @click="switchBranch(b.key)"
          >
            {{ b.label }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-1 mt-2 flex-1 px-2">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="px-3 py-2.5 rounded-lg text-sm text-white/70 hover:bg-slate-700 hover:text-white transition-colors"
          active-class="bg-indigo-600 text-white font-semibold hover:bg-indigo-600"
          :exact-active-class="item.exact ? 'bg-indigo-600 text-white font-semibold hover:bg-indigo-600' : undefined"
          @click="sidebarOpen = false"
        >
          <i class="bi" :class="item.icon"></i> {{ item.label }}
        </router-link>
      </div>

      <div class="p-3 border-t border-slate-700">
        <button class="btn btn-outline-light btn-sm w-full" @click="logout">
          <i class="bi bi-box-arrow-right"></i> Выйти
        </button>
        <div class="text-center mt-2 text-[11px] text-slate-500">v{{ auth.appVersion }}</div>
      </div>
    </nav>

    <div v-if="sidebarOpen" class="fixed inset-0 bg-black/40 z-30 md:hidden" @click="sidebarOpen = false"></div>

    <main class="flex-1 min-w-0 p-4 md:p-8">
      <h1 class="text-xl font-bold text-slate-800 mb-4">{{ pageTitle }}</h1>
      <slot />
    </main>
  </div>
</template>
