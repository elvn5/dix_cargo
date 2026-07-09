<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../api/client";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref("");
const password = ref("");
const remember = ref(false);
const showPassword = ref(false);
const error = ref("");
const loading = ref(false);

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    await auth.login(email.value, password.value, remember.value);
    const redirect = (route.query.redirect as string) || "/";
    router.push(redirect);
  } catch (e) {
    error.value = e instanceof ApiError ? "Неверный email или пароль" : "Ошибка сети";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-900 flex items-center justify-center p-4">
    <div class="card w-full max-w-sm p-6 shadow-xl">
      <div class="text-center mb-6">
        <div class="text-3xl">✈️</div>
        <h1 class="text-lg font-bold mt-2">DIX Cargo Admin</h1>
      </div>
      <div v-if="error" class="alert alert-danger">{{ error }}</div>
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="field-label">Email</label>
          <input v-model="email" type="email" class="input" required autofocus />
        </div>
        <div>
          <label class="field-label">Пароль</label>
          <div class="flex items-stretch gap-0 rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" class="flex-1 px-3 py-2 text-sm outline-none" required />
            <button type="button" tabindex="-1" class="px-3 text-slate-500 hover:bg-slate-50" @click="showPassword = !showPassword">
              <i class="bi" :class="showPassword ? 'bi-eye-slash' : 'bi-eye'"></i>
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <input id="remember" v-model="remember" type="checkbox" class="checkbox" />
          <label class="text-sm text-slate-500" for="remember">Запомнить меня на 30 дней</label>
        </div>
        <button class="btn btn-primary w-full" :disabled="loading">Войти</button>
      </form>
    </div>
  </div>
</template>
