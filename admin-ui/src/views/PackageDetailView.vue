<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import DuplicateTrackModal from "../components/DuplicateTrackModal.vue";
import { duplicateTrackFrom, type DuplicateTrack } from "../utils/duplicateTrack";

const route = useRoute();
const router = useRouter();
const pkgId = computed(() => Number(route.params.id));

interface PkgData {
  id: number;
  track_code: string;
  status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
  weight: number | null;
  price: number | null;
  created_at: string;
  updated_at: string;
  user: { client_code: string; full_name: string };
  delivery_group: {
    id: number;
    weight: number | null;
    price: number | null;
    created_at: string;
    packages: { id: number; track_code: string }[];
  } | null;
}

const pkg = ref<PkgData | null>(null);
const tariff = ref(0);
const loading = ref(true);
const saved = ref(route.query.saved === "1");
const duplicate = ref<DuplicateTrack | null>(null);

const form = reactive({
  track_code: "",
  status: "IN_TRANSIT" as "IN_TRANSIT" | "IN_OFFICE" | "DELIVERED",
  weight: "",
  price: "",
});

async function load() {
  loading.value = true;
  try {
    const data = await api.get<{ package: PkgData; tariff: number }>(`/admin/packages/${pkgId.value}`);
    pkg.value = data.package;
    tariff.value = data.tariff;
    form.track_code = data.package.track_code;
    form.status = data.package.status;
    form.weight = data.package.weight != null ? String(data.package.weight) : "";
    form.price = data.package.price != null ? String(data.package.price) : "";
    pageTitle.value = data.package.track_code;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      router.replace("/packages");
      return;
    }
    throw e;
  } finally {
    loading.value = false;
  }
}

watch(
  () => form.weight,
  (w) => {
    if (tariff.value > 0 && w !== "") form.price = (parseFloat(w) * tariff.value).toFixed(2);
  }
);

async function save() {
  try {
    await api.put(`/admin/packages/${pkgId.value}`, form);
  } catch (e) {
    const dup = duplicateTrackFrom(e);
    if (!dup) throw e;
    duplicate.value = dup;
    return;
  }
  router.replace({ query: { saved: "1" } });
  saved.value = true;
  await load();
}

async function remove() {
  if (!pkg.value || !confirm(`Удалить посылку ${pkg.value.track_code}?`)) return;
  await api.delete(`/admin/packages/${pkgId.value}`);
  router.push("/packages");
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("ru-RU");
}

onMounted(load);
</script>

<template>
  <LoadingSpinner v-if="loading" />
  <template v-else-if="pkg">
    <div v-if="saved" class="alert alert-success">Изменения сохранены.</div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2">
        <div class="card p-6">
          <form class="space-y-4" @submit.prevent="save">
            <div>
              <label class="field-label">Трек-код</label>
              <input v-model="form.track_code" class="input font-mono" required />
            </div>
            <div>
              <label class="field-label">Статус</label>
              <select v-model="form.status" class="select">
                <option value="IN_TRANSIT">🚚 В пути</option>
                <option value="IN_OFFICE">🏢 В офисе</option>
                <option value="DELIVERED">✅ Выдан</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label">Вес (кг)</label>
                <input v-model="form.weight" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
              </div>
              <div>
                <label class="field-label">Цена (сом)</label>
                <input v-model="form.price" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
                <div class="field-hint">Тариф: <b>{{ tariff }} сом/кг</b></div>
              </div>
            </div>
            <div class="flex gap-2 pt-2">
              <button class="btn btn-primary"><i class="bi bi-check-lg"></i> Сохранить</button>
              <router-link to="/packages" class="btn btn-outline">Назад</router-link>
            </div>
          </form>
        </div>
      </div>
      <div>
        <div class="card p-6">
          <div class="text-slate-500 text-xs font-semibold uppercase mb-3">Информация</div>
          <dl class="space-y-3 text-sm">
            <div>
              <dt class="text-slate-400 text-xs">Клиент</dt>
              <dd><span class="badge-code">{{ pkg.user.client_code }}</span> {{ pkg.user.full_name }}</dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">Вес</dt>
              <dd>{{ pkg.weight != null ? pkg.weight + " кг" : "—" }}</dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">Цена</dt>
              <dd>{{ pkg.price != null ? pkg.price.toLocaleString("ru-RU") + " сом" : "—" }}</dd>
            </div>
            <div v-if="pkg.delivery_group" data-test="delivery-group">
              <dt class="text-slate-400 text-xs">Выдача №{{ pkg.delivery_group.id }} от {{ fmtDateTime(pkg.delivery_group.created_at) }}</dt>
              <dd>
                {{ pkg.delivery_group.weight != null ? pkg.delivery_group.weight + " кг" : "—" }} ·
                {{ pkg.delivery_group.price != null ? pkg.delivery_group.price.toLocaleString("ru-RU") + " сом" : "—" }}
                <span class="text-slate-400">за {{ pkg.delivery_group.packages.length }} посыл.</span>
              </dd>
              <dd class="mt-1 flex flex-wrap gap-1">
                <router-link
                  v-for="gp in pkg.delivery_group.packages"
                  :key="gp.id"
                  :to="`/packages/${gp.id}`"
                  class="font-mono text-xs text-indigo-600 hover:underline"
                >{{ gp.track_code }}</router-link>
              </dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">Дата добавления</dt>
              <dd>{{ fmtDateTime(pkg.created_at) }}</dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">Последнее изменение</dt>
              <dd>{{ fmtDateTime(pkg.updated_at) }}</dd>
            </div>
          </dl>
        </div>
        <div class="card p-6 mt-4 border-red-200!">
          <div class="text-red-600 font-semibold mb-2 text-sm">Опасная зона</div>
          <button class="btn btn-outline-danger btn-sm w-full" @click="remove">
            <i class="bi bi-trash"></i> Удалить посылку
          </button>
        </div>
      </div>
    </div>
    <DuplicateTrackModal v-if="duplicate" :existing="duplicate" @close="duplicate = null" />
  </template>
</template>
