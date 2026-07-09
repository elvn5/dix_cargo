<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { pageTitle } from "../composables/pageTitle";
import FileDropZone from "../components/FileDropZone.vue";
import LoadingSpinner from "../components/LoadingSpinner.vue";

pageTitle.value = "Маркетплейсы";

const MARKETPLACE_KEYS = [
  { key: "marketplace_pinduoduo", name: "pinduoduo", label: "Pinduoduo" },
  { key: "marketplace_taobao", name: "taobao", label: "TaoBao" },
  { key: "marketplace_1688", name: "1688", label: "1688" },
  { key: "marketplace_poizon", name: "poizon", label: "Poizon" },
];

interface Section {
  key: string;
  name: string;
  label: string;
  value: string;
  hasPhoto: boolean;
  hasVideo: boolean;
}

const sections = ref<Section[]>([]);
const files = ref<Record<string, File>>({});
const saved = ref(false);
const submitting = ref(false);
const loading = ref(true);

async function load() {
  const data = await api.get<{ sections: { key: string; value: string; hasPhoto: boolean; hasVideo: boolean }[] }>(
    "/admin/marketplaces"
  );
  sections.value = MARKETPLACE_KEYS.map((m) => {
    const found = data.sections.find((s) => s.key === m.key);
    return { ...m, value: found?.value ?? "", hasPhoto: found?.hasPhoto ?? false, hasVideo: found?.hasVideo ?? false };
  });
  loading.value = false;
}

function onFileSelect(fieldName: string, file: File) {
  files.value[fieldName] = file;
}

async function save() {
  submitting.value = true;
  saved.value = false;
  try {
    const form = new FormData();
    for (const s of sections.value) form.append(s.key, s.value);
    for (const [field, file] of Object.entries(files.value)) form.append(field, file);
    await api.post("/admin/marketplaces", form);
    saved.value = true;
    files.value = {};
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="saved" class="alert alert-success">Изменения сохранены.</div>
  <LoadingSpinner v-if="loading" />
  <div v-else class="max-w-4xl">
    <div class="card p-6">
      <form @submit.prevent="save">
        <div v-for="s in sections" :key="s.key" class="mb-8 pb-6 border-b border-slate-100 last:border-0">
          <h2 class="font-bold mb-3">{{ s.label }}</h2>
          <div class="mb-4">
            <label class="field-label">Текст сообщения</label>
            <div class="text-xs text-slate-400 mb-1">
              Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;code&gt;). Используйте <code>{code}</code> для кода клиента.
            </div>
            <textarea v-model="s.value" class="textarea font-mono" rows="7"></textarea>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label mb-2">📷 Фото</label>
              <FileDropZone
                accept="image/*"
                icon="bi-image"
                :already-uploaded="s.hasPhoto"
                @select="(f) => onFileSelect(`${s.name}_photo`, f)"
              />
            </div>
            <div>
              <label class="field-label mb-2">🎬 Видео</label>
              <FileDropZone
                accept="video/*"
                icon="bi-camera-video"
                :already-uploaded="s.hasVideo"
                @select="(f) => onFileSelect(`${s.name}_video`, f)"
              />
            </div>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="submitting">
          <i class="bi bi-check-lg"></i> Сохранить все
        </button>
      </form>
    </div>
  </div>
</template>
