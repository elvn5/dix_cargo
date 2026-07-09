import express from "express";
import session from "express-session";
import { Bot, Context } from "grammy";
import path from "path";
import fs from "fs";
import { COOKIE_SECRET, PORT } from "./auth";
import { registerApiRoutes } from "./api";

const ADMIN_UI_DIST = path.resolve(process.cwd(), "admin-ui/dist");

export function createAdminApp(bot: Bot<Context>) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: COOKIE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
  }));

  registerApiRoutes(app, bot);

  // ── SPA (Vue admin-ui) ────────────────────────────────────────────────────

  if (fs.existsSync(ADMIN_UI_DIST)) {
    app.use("/admin", express.static(ADMIN_UI_DIST));
    app.get("/admin/{*splat}", (_req, res) => {
      res.sendFile(path.join(ADMIN_UI_DIST, "index.html"));
    });
  } else {
    app.get("/admin/{*splat}", (_req, res) => {
      res.status(503).send("Admin UI не собран. Запустите `npm run build` в admin-ui/.");
    });
  }

  app.get("/", (_req, res) => res.redirect("/admin"));

  return { app, port: PORT };
}
