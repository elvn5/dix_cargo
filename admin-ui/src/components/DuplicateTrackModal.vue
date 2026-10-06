<script setup lang="ts">
import type { DuplicateTrack } from "../utils/duplicateTrack";

defineProps<{ existing: DuplicateTrack }>();
const emit = defineEmits<{ close: [] }>();

const STATUS_LABEL: Record<string, string> = { IN_OFFICE: "В офисе", IN_TRANSIT: "В пути", DELIVERED: "Выдан" };
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
    data-test="duplicate-modal"
    @click.self="emit('close')"
  >
    <div class="card w-full max-w-md" role="alertdialog" aria-labelledby="dup-title">
      <div class="card-header flex items-center justify-between">
        <span id="dup-title" class="font-semibold text-red-600">
          <i class="bi bi-exclamation-triangle"></i> Такая посылка уже есть
        </span>
        <button class="text-slate-400 hover:text-slate-600" @click="emit('close')"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="p-6 space-y-3 text-sm">
        <p>
          Посылка с трек-кодом <b class="font-mono">{{ existing.track_code }}</b> уже добавлена.
          Повторно добавить её нельзя.
        </p>
        <dl class="space-y-2">
          <div>
            <dt class="text-slate-400 text-xs">Клиент</dt>
            <dd><span class="badge-code">{{ existing.client_code }}</span> {{ existing.full_name }}</dd>
          </div>
          <div>
            <dt class="text-slate-400 text-xs">Статус</dt>
            <dd>{{ STATUS_LABEL[existing.status] ?? existing.status }}</dd>
          </div>
        </dl>
        <div v-if="existing.in_trash" class="alert alert-warning" data-test="duplicate-in-trash">
          Клиент этой посылки находится в корзине. Восстановите его, если посылка его.
        </div>
        <div class="flex gap-2 pt-2">
          <router-link
            v-if="!existing.in_trash"
            :to="`/packages/${existing.id}`"
            class="btn btn-outline"
            @click="emit('close')"
          >
            Открыть посылку
          </router-link>
          <router-link v-else to="/trash" class="btn btn-outline" @click="emit('close')">Открыть корзину</router-link>
          <button type="button" class="btn btn-primary ml-auto" data-test="duplicate-close" @click="emit('close')">
            Понятно
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
