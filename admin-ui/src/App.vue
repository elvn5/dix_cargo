<script setup lang="ts">
import { useRoute } from "vue-router";
import AdminLayout from "./layouts/AdminLayout.vue";

const route = useRoute();
</script>

<template>
  <AdminLayout v-if="!route.meta.public">
    <router-view />
  </AdminLayout>
  <router-view v-else />
</template>
