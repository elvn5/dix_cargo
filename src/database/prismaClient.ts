import { PrismaClient } from "@prisma/client";

export type Branch = "bishkek" | "kant";

export const DEFAULT_BRANCH: Branch = "bishkek";

export const BRANCHES: { key: Branch; label: string }[] = [
  { key: "bishkek", label: "г. Бишкек" },
  { key: "kant", label: "г. Кант" },
];

const BRANCH_ENV_VAR: Record<Branch, string> = {
  bishkek: "DATABASE_URL",
  kant: "DATABASE_URL_KANT",
};

export function isBranch(value: string | undefined | null): value is Branch {
  return value === "bishkek" || value === "kant";
}

export function branchLabel(branch: Branch): string {
  return BRANCHES.find((b) => b.key === branch)?.label ?? branch;
}

const CLIENT_CODE_PREFIX: Record<Branch, string> = {
  bishkek: "DIX",
  kant: "KADIX",
};

export function clientCodePrefix(branch: Branch): string {
  return CLIENT_CODE_PREFIX[branch];
}

const clients = new Map<Branch, PrismaClient>();

function createClient(branch: Branch): PrismaClient {
  const envVar = BRANCH_ENV_VAR[branch];
  const url = process.env[envVar];
  if (!url) {
    throw new Error(`${envVar} is not defined in environment variables (требуется для филиала "${branchLabel(branch)}").`);
  }
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });
}

export function getDatabaseUrl(branch: Branch): string | undefined {
  return process.env[BRANCH_ENV_VAR[branch]];
}

export function getPrisma(branch: Branch = DEFAULT_BRANCH): PrismaClient {
  let client = clients.get(branch);
  if (!client) {
    client = createClient(branch);
    clients.set(branch, client);
  }
  return client;
}

export async function connectAllBranches(): Promise<void> {
  for (const { key } of BRANCHES) {
    await getPrisma(key).$connect();
  }
}

export async function disconnectAllBranches(): Promise<void> {
  for (const client of clients.values()) {
    await client.$disconnect();
  }
}
