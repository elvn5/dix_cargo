<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  accept: string;
  icon: string;
  alreadyUploaded: boolean;
}>();

const emit = defineEmits<{ (e: "select", file: File): void }>();

const dragOver = ref(false);
const selectedName = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

function openPicker() {
  inputRef.value?.click();
}

function handleFiles(files: FileList | null) {
  const file = files?.[0];
  if (!file) return;
  selectedName.value = file.name;
  emit("select", file);
}

function onInputChange(e: Event) {
  handleFiles((e.target as HTMLInputElement).files);
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  handleFiles(e.dataTransfer?.files ?? null);
  if (inputRef.value && e.dataTransfer?.files) inputRef.value.files = e.dataTransfer.files;
}
</script>

<template>
  <div
    class="file-drop-zone"
    :class="{ 'drag-over': dragOver, 'has-file': !!selectedName }"
    @click="openPicker"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop="onDrop"
  >
    <input ref="inputRef" type="file" :accept="props.accept" class="hidden" @change="onInputChange" />
    <i class="bi file-drop-icon" :class="props.icon"></i>
    <div class="file-drop-text">Нажмите или перетащите файл</div>
    <div class="file-drop-hint">
      <span v-if="selectedName" class="badge badge-success">выбрано</span>
      <span v-else-if="alreadyUploaded" class="badge badge-success">уже загружено</span>
      <span v-else class="badge badge-neutral">дефолт</span>
    </div>
    <div v-if="selectedName" class="file-drop-filename">{{ selectedName }}</div>
  </div>
</template>
