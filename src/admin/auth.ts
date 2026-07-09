import { Request, Response, NextFunction } from "express";
import { DEFAULT_BRANCH, type Branch } from "../database/prismaClient";

declare module "express-session" {
  interface SessionData {
    admin: boolean;
    branch?: Branch;
  }
}

export const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? "admin@dixcargo.com";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme";
export const COOKIE_SECRET  = process.env.ADMIN_COOKIE_SECRET ?? "dix-admin-secret";
export const PORT           = Number(process.env.ADMIN_PORT ?? 3000);
export const APP_VERSION    = process.env.APP_VERSION ?? "dev";
export const IS_STAGING     = APP_VERSION === "staging";

export function getBranch(req: Request): Branch {
  return req.session.branch ?? DEFAULT_BRANCH;
}

export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.admin) return next();
  res.status(401).json({ error: "unauthorized" });
}
