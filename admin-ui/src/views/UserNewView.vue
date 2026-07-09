<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Новый пользователь";

const router = useRouter();

const fullName = ref("");
const phone = ref("");
const clientCode = ref("");
const telegramId = ref("");
const codePrefix = ref("DIX");
const phoneInvalid = ref(false);
const error = ref("");
const submitting = ref(false);

onMounted(async () => {
  const meta = await api.get<{ codePrefix: string }>("/admin/meta");
  codePrefix.value = meta.codePrefix;
});

function validatePhone() {
  phoneInvalid.value = phone.value.length > 0 && !/^[0-9]{9}$/.test(phone.value);
}

async function submit() {
  validatePhone();
  if (!/^[0-9]{9}$/.test(phone.value)) {
    phoneInvalid.value = true;
    return;
  }
  error.value = "";
  submitting.value = true;
  try {
    const { user } = await api.post<{ user: { id: number } }>("/admin/users", {
      full_name: fullName.value,
      phone: phone.value,
      client_code: clientCode.value,
      telegram_id: telegramId.value,
    });
    router.push(`/users/${user.id}?saved=1`);
  } catch (e) {
    if (e instanceof ApiError && e.message === "phone") {
      error.value = "Неверный формат телефона. Введите ровно 9 цифр, например: 500123123";
    } else if (e instanceof ApiError && e.message === "duplicate_phone") {
      error.value = "Этот номер телефона уже используется другим пользователем.";
    } else {
      error.value = "Не удалось создать пользователя.";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="error" class="alert alert-danger">{{ error }}</div>
  <div class="max-w-xl">
    <div class="card p-6">
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="field-label">ФИО</label>
          <input v-model="fullName" class="input" required placeholder="Иванов Иван Иванович" />
        </div>
        <div>
          <label class="field-label">Телефон</label>
          <input
            v-model="phone"
            class="input"
            :class="{ 'input-invalid': phoneInvalid }"
            required
            placeholder="500123123"
            @input="validatePhone"
          />
          <div class="field-hint">Формат: 9 цифр, например <code>500123123</code></div>
          <div v-if="phoneInvalid" class="field-error">Введите ровно 9 цифр (без +, пробелов и кода страны)</div>
        </div>
        <div>
          <label class="field-label">
            Персональный КОД
            <span class="text-slate-400 font-normal">(оставьте пустым — сгенерируется автоматически)</span>
          </label>
          <input v-model="clientCode" class="input" :placeholder="`${codePrefix}-0001`" />
        </div>
        <div>
          <label class="field-label">
            Telegram ID
            <span class="text-slate-400 font-normal">(необязательно)</span>
          </label>
          <input v-model="telegramId" type="number" class="input" placeholder="123456789" />
        </div>
        <div class="flex gap-2 pt-2">
          <button class="btn btn-primary" :disabled="submitting">
            <i class="bi bi-person-plus"></i> Создать
          </button>
          <router-link to="/users" class="btn btn-outline">Отмена</router-link>
        </div>
      </form>
    </div>
  </div>
</template>
