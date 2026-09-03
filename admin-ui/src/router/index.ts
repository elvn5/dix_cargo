import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = createRouter({
  history: createWebHistory("/admin/"),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue"), meta: { public: true } },
    { path: "/", name: "dashboard", component: () => import("../views/DashboardView.vue") },
    { path: "/users", name: "users", component: () => import("../views/UsersListView.vue") },
    { path: "/users/new", name: "user-new", component: () => import("../views/UserNewView.vue") },
    { path: "/users/:id", name: "user-detail", component: () => import("../views/UserDetailView.vue"), props: true },
    { path: "/packages", name: "packages", component: () => import("../views/PackagesListView.vue") },
    { path: "/packages/import", name: "packages-import", component: () => import("../views/PackagesImportView.vue") },
    { path: "/packages/new", name: "package-new", component: () => import("../views/PackageNewView.vue") },
    { path: "/packages/:id", name: "package-detail", component: () => import("../views/PackageDetailView.vue"), props: true },
    { path: "/delivery", name: "delivery", component: () => import("../views/DeliveryView.vue") },
    { path: "/promocodes", name: "promocodes", component: () => import("../views/PromoCodesView.vue") },
    { path: "/reset-requests", name: "reset-requests", component: () => import("../views/ResetRequestsView.vue") },
    { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },
    { path: "/marketplaces", name: "marketplaces", component: () => import("../views/MarketplacesView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.fetchMe();

  if (!to.meta.public && !auth.authenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.name === "login" && auth.authenticated) {
    return { name: "dashboard" };
  }
  return true;
});

export default router;
