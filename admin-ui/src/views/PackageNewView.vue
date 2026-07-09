<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Новая посылка";

const router = useRouter();

const users = ref<{ id: number; client_code: string; full_name: string }[]>([]);
const tariff = ref(0);

const userId = ref<number | null>(null);
const trackCode = ref("");
const status = ref<"IN_TRANSIT" | "IN_OFFICE" | "DELIVERED">("IN_TRANSIT");
const weight = ref("");
const price = ref("");
const submitting = ref(false);

onMounted(async () => {
  const data = await api.get<{ tariff: number; users: { id: number; client_code: string; full_name: string }[] }>(
    "/admin/packages/new-meta"
  );
  tariff.value = data.tariff;
  users.value = data.users;
  userId.value = data.users[0]?.id ?? null;
});

watch(weight, (w) => {
  if (tariff.value > 0 && w !== "") price.value = (parseFloat(w) * tariff.value).toFixed(2);
});

function onTrackCodeKeydown(e: KeyboardEvent) {
  // Не даём завершающему Enter от сканера сабмитить форму раньше времени
  if (e.key === "Enter") e.preventDefault();
}

async function submit() {
  submitting.value = true;
  try {
    await api.post("/admin/packages", {
      user_id: userId.value,
      track_code: trackCode.value,
      status: status.value,
      weight: weight.value || undefined,
      price: price.value || undefined,
    });
    router.push("/packages");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="max-w-xl">
    <div class="card p-6">
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="field-label">Клиент</label>
          <select v-model="userId" class="select" required>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.client_code }} — {{ u.full_name }}</option>
          </select>
        </div>
        <div>
          <label class="field-label">Трек-код</label>
          <input
            v-model="trackCode"
            class="input font-mono"
            required
            placeholder="RU123456789CN"
            autocomplete="off"
            @keydown="onTrackCodeKeydown"
          />
        </div>
        <div>
          <label class="field-label">Статус</label>
          <select v-model="status" class="select">
            <option value="IN_TRANSIT">🚚 В пути</option>
            <option value="IN_OFFICE">🏢 В офисе</option>
            <option value="DELIVERED">✅ Выдан</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="field-label">Вес (кг)</label>
            <input v-model="weight" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
          </div>
          <div>
            <label class="field-label">Цена (сом)</label>
            <input v-model="price" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
            <div class="field-hint">Тариф: <b>{{ tariff }} сом/кг</b></div>
          </div>
        </div>
        <div class="flex gap-2 pt-2">
          <button class="btn btn-primary" :disabled="submitting">
            <i class="bi bi-plus-lg"></i> Добавить
          </button>
          <router-link to="/packages" class="btn btn-outline">Отмена</router-link>
        </div>
      </form>
    </div>
  </div>
</template>
