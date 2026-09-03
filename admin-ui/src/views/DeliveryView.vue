<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";

pageTitle.value = "Выдача";

interface ClientRow {
  id: number;
  client_code: string;
  full_name: string;
  phone: string;
  packages_count: number;
}
interface PackageRow {
  id: number;
  track_code: string;
  status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
  weight: number | null;
  price: number | null;
  created_at: string;
  updated_at: string;
}

// ── Окно 1: поиск и список клиентов ─────────────────────────────────────────
const q = ref("");
const clients = ref<ClientRow[]>([]);
const clientsTotal = ref(0);
const clientsLoading = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

async function loadClients() {
  clientsLoading.value = true;
  try {
    const params = new URLSearchParams({ page: "1", q: q.value });
    const data = await api.get<{ users: ClientRow[]; total: number }>(`/admin/users?${params}`);
    clients.value = data.users;
    clientsTotal.value = data.total;
  } finally {
    clientsLoading.value = false;
  }
}

watch(q, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(loadClients, 300);
});

// ── Окно 2: посылки выбранного клиента (только «В офисе») ────────────────────
const selectedClient = ref<ClientRow | null>(null);
const packages = ref<PackageRow[]>([]);
const packagesLoading = ref(false);
const tariff = ref(0);
const selectedIds = ref<Set<number>>(new Set());

async function selectClient(c: ClientRow) {
  selectedClient.value = c;
  selectedIds.value = new Set();
  weight.value = "";
  price.value = "";
  successMsg.value = "";
  packagesLoading.value = true;
  packages.value = [];
  try {
    const data = await api.get<{ packages: PackageRow[]; tariff: number }>(`/admin/users/${c.id}`);
    packages.value = data.packages.filter((p) => p.status === "IN_OFFICE");
    tariff.value = data.tariff;
  } finally {
    packagesLoading.value = false;
  }
}

const allChecked = computed(
  () => packages.value.length > 0 && selectedIds.value.size === packages.value.length,
);
function toggleAll(checked: boolean) {
  selectedIds.value = checked ? new Set(packages.value.map((p) => p.id)) : new Set();
}
function toggle(id: number) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

// ── Окно 3: выбранные к выдаче ───────────────────────────────────────────────
const selectedPackages = computed(() => packages.value.filter((p) => selectedIds.value.has(p.id)));
const weight = ref("");
const price = ref("");
const delivering = ref(false);
const successMsg = ref("");

watch(weight, (w) => {
  if (tariff.value > 0 && w !== "") price.value = (parseFloat(w) * tariff.value).toFixed(2);
});

async function deliver() {
  if (!selectedClient.value || selectedIds.value.size === 0) return;
  delivering.value = true;
  try {
    const count = selectedIds.value.size;
    await api.post(`/admin/users/${selectedClient.value.id}/packages/status`, {
      ids: [...selectedIds.value],
      status: "DELIVERED",
      weight: weight.value || undefined,
      price: price.value || undefined,
    });
    successMsg.value = `Выдано посылок: ${count}`;
    weight.value = "";
    price.value = "";
    // Перезагружаем — выданные уходят из списка «В офисе»
    await selectClientReload();
  } finally {
    delivering.value = false;
  }
}

// перезагрузка посылок текущего клиента без сброса successMsg
async function selectClientReload() {
  const c = selectedClient.value;
  if (!c) return;
  const msg = successMsg.value;
  await selectClient(c);
  successMsg.value = msg;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ru-RU");
}

onMounted(loadClients);
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
    <!-- Окно 1: клиенты -->
    <div class="card flex flex-col h-[74vh]">
      <div class="card-header">
        <span class="font-semibold">Клиенты <span class="badge badge-neutral">{{ clientsTotal }}</span></span>
        <input
          v-model="q"
          class="input mt-3 w-full"
          placeholder="Поиск по имени, телефону, коду..."
          data-test="client-search"
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="clientsLoading" class="p-4 text-center text-slate-400 text-sm">Загрузка…</div>
        <div v-else-if="clients.length === 0" class="p-6 text-center text-slate-400 text-sm">Никого не найдено</div>
        <button
          v-for="c in clients"
          :key="c.id"
          class="w-full text-left px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
          :class="{ 'bg-indigo-50 hover:bg-indigo-50': selectedClient?.id === c.id }"
          data-test="client-row"
          @click="selectClient(c)"
        >
          <div class="flex items-center gap-2">
            <span class="badge-code">{{ c.client_code }}</span>
            <span class="badge badge-neutral ml-auto">{{ c.packages_count }}</span>
          </div>
          <div class="text-sm text-slate-800 mt-1">{{ c.full_name }}</div>
          <div class="text-xs text-slate-400">{{ c.phone }}</div>
        </button>
      </div>
    </div>

    <!-- Окно 2: посылки клиента (В офисе) -->
    <div class="card flex flex-col h-[74vh]">
      <div class="card-header flex items-center justify-between gap-2">
        <span class="font-semibold">
          Посылки в офисе
          <span v-if="selectedClient" class="badge badge-neutral">{{ packages.length }}</span>
        </span>
        <label v-if="packages.length > 0" class="text-xs text-slate-500 flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            class="checkbox"
            :checked="allChecked"
            data-test="check-all"
            @change="toggleAll(($event.target as HTMLInputElement).checked)"
          />
          Выбрать все
        </label>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="!selectedClient" class="p-6 text-center text-slate-400 text-sm">Выберите клиента слева</div>
        <div v-else-if="packagesLoading" class="p-4 text-center text-slate-400 text-sm">Загрузка…</div>
        <div v-else-if="packages.length === 0" class="p-6 text-center text-slate-400 text-sm">
          Нет посылок в офисе для выдачи
        </div>
        <label
          v-for="p in packages"
          :key="p.id"
          class="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
          data-test="package-row"
        >
          <input
            type="checkbox"
            class="checkbox"
            :checked="selectedIds.has(p.id)"
            @change="toggle(p.id)"
          />
          <div class="min-w-0">
            <div class="font-mono text-xs truncate">{{ p.track_code }}</div>
            <div class="text-xs text-slate-400">поступила {{ fmtDate(p.updated_at) }}</div>
          </div>
          <span v-if="p.weight != null" class="text-xs text-slate-500 ml-auto whitespace-nowrap">{{ p.weight }} кг</span>
        </label>
      </div>
    </div>

    <!-- Окно 3: к выдаче -->
    <div class="card flex flex-col h-[74vh]">
      <div class="card-header">
        <span class="font-semibold">К выдаче <span class="badge badge-primary">{{ selectedPackages.length }}</span></span>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="successMsg" class="m-3 alert alert-success">{{ successMsg }}</div>
        <div v-if="selectedPackages.length === 0" class="p-6 text-center text-slate-400 text-sm">
          Отметьте посылки в среднем окне
        </div>
        <div
          v-for="p in selectedPackages"
          :key="p.id"
          class="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100"
          data-test="deliver-row"
        >
          <span class="font-mono text-xs truncate">{{ p.track_code }}</span>
          <button
            class="ml-auto text-slate-400 hover:text-red-600"
            title="Убрать"
            @click="toggle(p.id)"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>

      <div class="card-footer space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="field-label">Вес (кг)</label>
            <input v-model="weight" type="number" min="0" step="0.01" class="input" placeholder="0.00" data-test="deliver-weight" />
          </div>
          <div>
            <label class="field-label">Цена (сом)</label>
            <input v-model="price" type="number" min="0" step="0.01" class="input" placeholder="0.00" data-test="deliver-price" />
          </div>
        </div>
        <div v-if="tariff > 0" class="text-xs text-slate-500">Тариф: <b>{{ tariff }} сом/кг</b></div>
        <button
          class="btn btn-primary w-full"
          :disabled="selectedPackages.length === 0 || delivering"
          data-test="deliver-btn"
          @click="deliver"
        >
          <i class="bi bi-bag-check"></i> Выдать
        </button>
      </div>
    </div>
  </div>
</template>
