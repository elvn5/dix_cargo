<script setup lang="ts">
withDefaults(defineProps<{ label?: string; compact?: boolean }>(), {
  label: "Загрузка…",
  compact: false,
});
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 text-slate-400" :class="compact ? 'py-6' : 'py-16'">
    <span class="w-7 h-7 rounded-full border-[3px] border-slate-200 border-t-indigo-600 animate-spin"></span>
    <span v-if="label" class="text-sm">{{ label }}</span>
  </div>
</template>
