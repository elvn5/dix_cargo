<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import { botChatId } from "../utils/chatId";
import DuplicateTrackModal from "../components/DuplicateTrackModal.vue";
import { duplicateTrackFrom, type DuplicateTrack } from "../utils/duplicateTrack";

const route = useRoute();
const router = useRouter();
const userId = computed(() => Number(route.params.id));

interface UserData {
  id: number;
  client_code: string;
  full_name: string;
  phone: string;
  telegram_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface DeliveryRow {
  id: number;
  weight: number | null;
  price: number | null;
  created_at: string;
  packages: { id: number; track_code: string }[];
}
interface PackageRow {
  id: number;
  track_code: string;
  status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
  created_at: string;
  updated_at: string;
}

const STATUS_LABEL: Record<string, string> = { IN_OFFICE: "В офисе", IN_TRANSIT: "В пути", DELIVERED: "Выдан" };
const STATUS_BADGE: Record<string, string> = { IN_OFFICE: "badge-warning", IN_TRANSIT: "badge-primary", DELIVERED: "badge-success" };

const user = reactive<UserData>({ id: 0, client_code: "", full_name: "", phone: "", telegram_id: "", created_at: "", updated_at: "", deleted_at: null });
const packages = ref<PackageRow[]>([]);
const deliveries = ref<DeliveryRow[]>([]);
const tariff = ref(0);
const loading = ref(true);

const savedMsg = ref(route.query.saved === "1");
const pkgSavedMsg = ref(route.query.pkg_saved === "1");
const editError = ref("");

const editForm = reactive({ client_code: "", full_name: "", phone: "" });

const selected = reactive(new Set<number>());
const bulkStatus = ref<"IN_TRANSIT" | "IN_OFFICE" | "DELIVERED">("IN_TRANSIT");
const bulkWeight = ref("");
const bulkPrice = ref("");
const cbAllRef = ref<HTMLInputElement | null>(null);

const selectedCount = computed(() => selected.size);
const allChecked = computed(() => packages.value.length > 0 && selected.size === packages.value.length);
const indeterminate = computed(() => selected.size > 0 && selected.size < packages.value.length);

watch([allChecked, indeterminate], () => {
  if (cbAllRef.value) cbAllRef.value.indeterminate = indeterminate.value;
});

watch(bulkWeight, (w) => {
  if (tariff.value > 0 && w !== "") bulkPrice.value = (parseFloat(w) * tariff.value).toFixed(2);
});

function toggleAll(checked: boolean) {
  selected.clear();
  if (checked) packages.value.forEach((p) => selected.add(p.id));
}
function toggleOne(id: number, checked: boolean) {
  if (checked) selected.add(id);
  else selected.delete(id);
}

async function load() {
  loading.value = true;
  try {
    const data = await api.get<{ user: UserData; packages: PackageRow[]; tariff: number; deliveries?: DeliveryRow[] }>(`/admin/users/${userId.value}`);
    Object.assign(user, data.user);
    editForm.client_code = data.user.client_code;
    editForm.full_name = data.user.full_name;
    editForm.phone = data.user.phone;
    packages.value = data.packages;
    deliveries.value = data.deliveries ?? [];
    tariff.value = data.tariff;
    pageTitle.value = data.user.full_name;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      router.replace("/users");
      return;
    }
    throw e;
  } finally {
    loading.value = false;
  }
}

async function saveUser() {
  editError.value = "";
  try {
    await api.put(`/admin/users/${userId.value}`, editForm);
    router.replace({ query: { saved: "1" } });
    savedMsg.value = true;
    await load();
  } catch (e) {
    if (e instanceof ApiError && e.message === "duplicate_code") editError.value = "Код клиента уже занят — введите другой.";
    else if (e instanceof ApiError && e.message === "duplicate_phone") editError.value = "Этот номер телефона уже используется другим пользователем.";
    else editError.value = "Не удалось сохранить изменения.";
  }
}

async function deleteUser() {
  if (!confirm(`Переместить пользователя ${user.full_name} в корзину вместе с его посылками?\nВосстановить можно в разделе «Корзина».`)) return;
  await api.delete(`/admin/users/${userId.value}`);
  router.push("/users");
}

async function restoreUser() {
  await api.post(`/admin/trash/${userId.value}/restore`);
  await load();
}

async function applyBulkStatus() {
  if (selected.size === 0) return;
  await api.post(`/admin/users/${userId.value}/packages/status`, {
    ids: [...selected],
    status: bulkStatus.value,
    weight: bulkWeight.value || undefined,
    price: bulkPrice.value || undefined,
  });
  selected.clear();
  bulkWeight.value = "";
  bulkPrice.value = "";
  pkgSavedMsg.value = true;
  await load();
}

async function deleteSelected() {
  if (selected.size === 0) return;
  if (!confirm(`Удалить выбранные посылки (${selected.size})?`)) return;
  await api.post(`/admin/users/${userId.value}/packages/delete`, { ids: [...selected] });
  selected.clear();
  await load();
}

// ── Модальное окно добавления посылки ──────────────────────────────────────
const showAddModal = ref(false);
const addForm = reactive({ trackCode: "", status: "IN_TRANSIT" as "IN_TRANSIT" | "IN_OFFICE" | "DELIVERED", weight: "", price: "" });
const addSubmitting = ref(false);
const duplicate = ref<DuplicateTrack | null>(null);

watch(() => addForm.weight, (w) => {
  if (tariff.value > 0 && w !== "") addForm.price = (parseFloat(w) * tariff.value).toFixed(2);
});

function openAddModal() {
  addForm.trackCode = "";
  addForm.status = "IN_TRANSIT";
  addForm.weight = "";
  addForm.price = "";
  showAddModal.value = true;
}

function closeAddModal() {
  showAddModal.value = false;
}

function onTrackCodeKeydown(e: KeyboardEvent) {
  // Не даём завершающему Enter от сканера сабмитить форму раньше времени
  if (e.key === "Enter") e.preventDefault();
}

async function submitAddPackage() {
  addSubmitting.value = true;
  try {
    await api.post("/admin/packages", {
      user_id: userId.value,
      track_code: addForm.trackCode,
      status: addForm.status,
      weight: addForm.weight || undefined,
      price: addForm.price || undefined,
    });
    showAddModal.value = false;
    await load();
  } catch (e) {
    const dup = duplicateTrackFrom(e);
    if (!dup) throw e;
    duplicate.value = dup;
  } finally {
    addSubmitting.value = false;
  }
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ru-RU");
}

// ── Сканер штрихкодов ──────────────────────────────────────────────────────
const scanBadgeState = ref<"idle" | "success" | "error">("idle");
const scanResultText = ref("");
const scanResultVisible = ref(false);
let scanBuffer = "";
let bufTimer: ReturnType<typeof setTimeout> | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
const flashRowId = ref<number | null>(null);

function processScan(raw: string) {
  const code = raw.trim();
  if (!code) return;
  const pkg = packages.value.find((p) => p.track_code === code);
  if (pkg) {
    selected.add(pkg.id);
    flashRowId.value = pkg.id;
    setTimeout(() => { if (flashRowId.value === pkg.id) flashRowId.value = null; }, 1800);
    scanBadgeState.value = "success";
    scanResultText.value = "✓ " + code;
  } else {
    scanBadgeState.value = "error";
    scanResultText.value = "✗ " + code + " — не найден";
  }
  scanResultVisible.value = true;
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanBadgeState.value = "idle";
    scanResultVisible.value = false;
  }, 3000);
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;

  if (e.key === "Enter") {
    if (scanBuffer) processScan(scanBuffer);
    scanBuffer = "";
    if (bufTimer) clearTimeout(bufTimer);
    return;
  }
  if (e.key.length === 1) {
    scanBuffer += e.key;
    if (bufTimer) clearTimeout(bufTimer);
    bufTimer = setTimeout(() => {
      if (scanBuffer) processScan(scanBuffer);
      scanBuffer = "";
    }, 150);
  }
}

onMounted(() => {
  load();
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <LoadingSpinner v-if="loading" />
  <template v-else>
    <div v-if="user.deleted_at" class="alert alert-warning flex items-center gap-3 flex-wrap" data-test="trash-banner">
      <span>
        <i class="bi bi-trash"></i> Клиент в корзине с {{ new Date(user.deleted_at).toLocaleString("ru-RU") }} —
        он и его посылки скрыты из списков и бота.
      </span>
      <button class="btn btn-primary btn-sm ml-auto" data-test="restore-user" @click="restoreUser">
        <i class="bi bi-arrow-counterclockwise"></i> Восстановить
      </button>
    </div>
    <div v-if="savedMsg" class="alert alert-success">Изменения сохранены.</div>
    <div v-if="editError" class="alert alert-danger">{{ editError }}</div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2">
        <div class="card p-6">
          <form class="space-y-4" @submit.prevent="saveUser">
            <div>
              <label class="field-label">Персональный КОД</label>
              <input v-model="editForm.client_code" class="input" required />
            </div>
            <div>
              <label class="field-label">ФИО</label>
              <input v-model="editForm.full_name" class="input" required />
            </div>
            <div>
              <label class="field-label">Телефон</label>
              <input v-model="editForm.phone" class="input" required />
            </div>
            <div class="flex gap-2 pt-2">
              <button class="btn btn-primary"><i class="bi bi-check-lg"></i> Сохранить</button>
              <router-link to="/users" class="btn btn-outline">Назад</router-link>
            </div>
          </form>
        </div>
      </div>
      <div>
        <div class="card p-6">
          <div class="text-slate-500 text-xs font-semibold uppercase mb-3">Информация</div>
          <dl class="space-y-3 text-sm">
            <div data-test="chat-id">
              <dt class="text-slate-400 text-xs">Chat ID с ботом</dt>
              <dd v-if="botChatId(user.telegram_id)" class="font-mono">{{ botChatId(user.telegram_id) }}</dd>
              <dd v-else class="text-amber-700">
                Нет — клиент ещё не писал боту, уведомления ему не доходят
                <div class="text-xs text-slate-400 font-mono">служебный ID {{ user.telegram_id }}</div>
              </dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">Дата регистрации</dt>
              <dd>{{ new Date(user.created_at).toLocaleString("ru-RU") }}</dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">Последнее обновление</dt>
              <dd>{{ new Date(user.updated_at).toLocaleString("ru-RU") }}</dd>
            </div>
          </dl>
        </div>
        <div v-if="!user.deleted_at" class="card p-6 mt-4 border-red-200!">
          <div class="text-red-600 font-semibold mb-2 text-sm">Опасная зона</div>
          <button class="btn btn-outline-danger btn-sm w-full" @click="deleteUser">
            <i class="bi bi-trash"></i> В корзину
          </button>
          <div class="text-xs text-slate-400 mt-2">Клиент и его посылки попадут в корзину, откуда их можно восстановить.</div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-header flex items-center justify-between flex-wrap gap-2">
        <span class="font-semibold">Посылки <span class="badge badge-neutral">{{ packages.length }}</span></span>
        <div class="flex items-center gap-2">
          <span v-if="pkgSavedMsg" class="text-emerald-600 text-sm"><i class="bi bi-check-circle"></i> Статусы обновлены</span>
          <span
            class="badge"
            :class="scanBadgeState === 'success' ? 'badge-success' : scanBadgeState === 'error' ? 'badge-danger' : 'badge-neutral'"
            title="Наведите сканер и сканируйте трек-код"
          >
            <i class="bi bi-upc-scan"></i> Сканер
          </span>
          <span v-if="scanResultVisible" class="text-sm" :class="scanBadgeState === 'success' ? 'text-emerald-600' : 'text-red-600'">
            {{ scanResultText }}
          </span>
        </div>
      </div>

      <div v-if="packages.length === 0" class="p-8 text-center">
        <div class="text-slate-400 mb-3">Посылок нет</div>
        <button class="btn btn-outline btn-sm" @click="openAddModal"><i class="bi bi-plus-lg"></i> Добавить</button>
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="w-10 text-center">
                  <input
                    ref="cbAllRef"
                    type="checkbox"
                    class="checkbox"
                    title="Выбрать все"
                    :checked="allChecked"
                    @change="toggleAll(($event.target as HTMLInputElement).checked)"
                  />
                </th>
                <th>Трек-номер</th>
                <th>Статус</th>
                <th>Дата отправки</th>
                <th>Дата поступления</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in packages" :key="p.id" :class="{ 'flash-row': flashRowId === p.id }">
                <td class="text-center">
                  <input
                    type="checkbox"
                    class="checkbox"
                    :checked="selected.has(p.id)"
                    @change="toggleOne(p.id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="font-mono text-xs">{{ p.track_code }}</td>
                <td><span class="badge" :class="STATUS_BADGE[p.status]">{{ STATUS_LABEL[p.status] }}</span></td>
                <td class="text-slate-400 text-xs">{{ fmtDate(p.created_at) }}</td>
                <td class="text-slate-400 text-xs">{{ fmtDate(p.updated_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-footer flex items-center gap-2 flex-wrap">
          <span class="text-slate-500 text-sm">Выбрано: {{ selectedCount }}</span>
          <select v-model="bulkStatus" class="select w-auto">
            <option value="IN_TRANSIT">В пути</option>
            <option value="IN_OFFICE">В офисе</option>
          </select>
          <div v-if="bulkStatus === 'IN_OFFICE'" class="flex items-center gap-2 flex-wrap">
            <div class="flex items-center rounded-lg border border-slate-300 overflow-hidden">
              <span class="px-2 text-xs text-slate-500 bg-slate-50">Вес</span>
              <input v-model="bulkWeight" type="number" min="0" step="0.01" class="w-24 px-2 py-1.5 text-sm outline-none" placeholder="кг" />
              <span class="px-2 text-xs text-slate-500 bg-slate-50">кг</span>
            </div>
            <div class="flex items-center rounded-lg border border-slate-300 overflow-hidden">
              <span class="px-2 text-xs text-slate-500 bg-slate-50">Цена</span>
              <input v-model="bulkPrice" type="number" min="0" step="0.01" class="w-24 px-2 py-1.5 text-sm outline-none" placeholder="сом" />
              <span class="px-2 text-xs text-slate-500 bg-slate-50">сом</span>
            </div>
            <span v-if="tariff > 0" class="text-xs text-slate-500" data-test="tariff-hint">
              Тариф: <b>{{ tariff }} сом/кг</b>
            </span>
            <router-link v-else to="/settings" class="text-xs text-amber-600" data-test="tariff-missing">
              Тариф не задан — цена не подставится
            </router-link>
          </div>
          <button class="btn btn-primary btn-sm" :disabled="selectedCount === 0" @click="applyBulkStatus">
            <i class="bi bi-check2-all"></i> Применить к выбранным
          </button>
          <button class="btn btn-outline-danger btn-sm" :disabled="selectedCount === 0" @click="deleteSelected">
            <i class="bi bi-trash"></i> Удалить
          </button>
          <button class="btn btn-outline btn-sm" @click="openAddModal">
            <i class="bi bi-plus-lg"></i> Добавить
          </button>
        </div>
      </template>
    </div>

    <div v-if="deliveries.length > 0" class="card mt-6" data-test="deliveries">
      <div class="card-header">
        <span class="font-semibold">Выдачи <span class="badge badge-neutral">{{ deliveries.length }}</span></span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>№</th><th>Дата</th><th>Посылки</th><th>Вес</th><th>Цена</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in deliveries" :key="d.id">
              <td class="text-slate-400 text-xs">{{ d.id }}</td>
              <td class="text-xs">{{ new Date(d.created_at).toLocaleString("ru-RU") }}</td>
              <td>
                <div class="flex flex-wrap gap-1">
                  <router-link
                    v-for="gp in d.packages"
                    :key="gp.id"
                    :to="`/packages/${gp.id}`"
                    class="font-mono text-xs text-indigo-600 hover:underline"
                  >{{ gp.track_code }}</router-link>
                </div>
              </td>
              <td class="whitespace-nowrap">{{ d.weight != null ? d.weight + " кг" : "—" }}</td>
              <td class="whitespace-nowrap">{{ d.price != null ? d.price.toLocaleString("ru-RU") + " сом" : "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DuplicateTrackModal v-if="duplicate" :existing="duplicate" @close="duplicate = null" />

    <div v-if="showAddModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="closeAddModal">
      <div class="card w-full max-w-md">
        <div class="card-header flex items-center justify-between">
          <span class="font-semibold">Новая посылка</span>
          <button class="text-slate-400 hover:text-slate-600" @click="closeAddModal"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="p-6">
          <form class="space-y-4" @submit.prevent="submitAddPackage">
            <div>
              <label class="field-label">Трек-код</label>
              <input
                v-model="addForm.trackCode"
                class="input font-mono"
                required
                placeholder="RU123456789CN"
                autocomplete="off"
                @keydown="onTrackCodeKeydown"
              />
            </div>
            <div>
              <label class="field-label">Статус</label>
              <select v-model="addForm.status" class="select">
                <option value="IN_TRANSIT">🚚 В пути</option>
                <option value="IN_OFFICE">🏢 В офисе</option>
                <option value="DELIVERED">✅ Выдан</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label">Вес (кг)</label>
                <input v-model="addForm.weight" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
              </div>
              <div>
                <label class="field-label">Цена (сом)</label>
                <input v-model="addForm.price" type="number" min="0" step="0.01" class="input" placeholder="0.00" />
                <div class="field-hint">Тариф: <b>{{ tariff }} сом/кг</b></div>
              </div>
            </div>
            <div class="flex gap-2 pt-2">
              <button class="btn btn-primary" :disabled="addSubmitting">
                <i class="bi bi-plus-lg"></i> Добавить
              </button>
              <button type="button" class="btn btn-outline" @click="closeAddModal">Отмена</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.flash-row {
  background: #d1f7e0 !important;
  transition: background 0.2s;
}
</style>
