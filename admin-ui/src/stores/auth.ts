import { defineStore } from "pinia";
import { api } from "../api/client";

export type Branch = "bishkek" | "kant";

interface MeResponse {
  authenticated: boolean;
  branch: Branch;
  branches: { key: Branch; label: string }[];
  appVersion: string;
  isStaging: boolean;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    authenticated: false,
    checked: false,
    branch: "bishkek" as Branch,
    branches: [] as { key: Branch; label: string }[],
    appVersion: "dev",
    isStaging: false,
  }),
  actions: {
    async fetchMe() {
      try {
        const me = await api.get<MeResponse>("/admin/me");
        this.authenticated = me.authenticated;
        this.branch = me.branch;
        this.branches = me.branches;
        this.appVersion = me.appVersion;
        this.isStaging = me.isStaging;
      } catch {
        this.authenticated = false;
      } finally {
        this.checked = true;
      }
    },
    async login(email: string, password: string, remember: boolean) {
      await api.post("/admin/login", { email, password, remember });
      await this.fetchMe();
    },
    async logout() {
      await api.post("/admin/logout");
      this.authenticated = false;
    },
    async setBranch(branch: Branch) {
      await api.post("/admin/branch", { branch });
      this.branch = branch;
    },
  },
});
