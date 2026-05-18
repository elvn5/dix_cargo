import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import multer from "multer";
import * as XLSX from "xlsx";
import { Bot, Context } from "grammy";
import prisma from "../database/prismaClient";
import { userService } from "../services/userService";
import { parseClientCode } from "../utils/parseClientCode";
import fs from "fs";
import path from "path";

declare module "express-session" {
  interface SessionData {
    admin: boolean;
  }
}

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? "admin@dixcargo.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme";
const COOKIE_SECRET  = process.env.ADMIN_COOKIE_SECRET ?? "dix-admin-secret";
const PORT           = Number(process.env.ADMIN_PORT ?? 3000);

// ── HTML helpers ─────────────────────────────────────────────────────────────

function layout(title: string, body: string, active = ""): string {
  const nav = (href: string, label: string, icon: string) => {
    const cls = active === href ? "nav-link active fw-semibold" : "nav-link text-white-50";
    return `<a href="${href}" class="${cls}">${icon} ${label}</a>`;
  };
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — DIX Cargo Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet"/>
  <style>
    body { background:#f0f2f5; }
    .sidebar { width:240px; flex-shrink:0; background:#1a1f36 !important; }
    .sidebar .brand { font-size:1.25rem; font-weight:700; color:#fff; padding:1.5rem 1rem; border-bottom:1px solid #2d3561; }
    .sidebar .nav-link { padding:.6rem 1rem; border-radius:6px; margin:.1rem .5rem; }
    .sidebar .nav-link.active { background:#4e6ef2; color:#fff !important; }
    .sidebar .nav-link:hover:not(.active) { background:#2d3561; color:#fff !important; }
    .main { flex:1; padding:2rem; min-width:0; }
    .stat-card { border:none; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.07); }
    .table th { background:#f8f9fa; font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
    .badge-code { background:#e8edff; color:#4e6ef2; font-family:monospace; font-size:.85rem; padding:.3em .6em; border-radius:6px; }
    .topbar { background:#1a1f36; }
    @media (max-width:767.98px) {
      .main { padding:1rem; }
      .offcanvas.sidebar { width:240px !important; min-height:100vh; }
    }
    @media (min-width:768px) {
      .sidebar { min-height:100vh; display:flex !important; flex-direction:column; }
    }
  </style>
</head>
<body>
<header class="topbar d-flex d-md-none align-items-center justify-content-between px-3 py-2">
  <span style="font-size:1.1rem;font-weight:700;color:#fff">✈️ DIX Cargo</span>
  <button class="border-0 bg-transparent" data-bs-toggle="offcanvas" data-bs-target="#sidebar" style="color:#fff">
    <i class="bi bi-list fs-3"></i>
  </button>
</header>
<div class="d-flex">
  <nav class="sidebar offcanvas-md offcanvas-start flex-column p-0" tabindex="-1" id="sidebar">
    <div class="offcanvas-header d-md-none" style="background:#1a1f36;border-bottom:1px solid #2d3561">
      <span style="font-size:1.1rem;font-weight:700;color:#fff">✈️ DIX Cargo</span>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" data-bs-target="#sidebar"></button>
    </div>
    <div class="brand d-none d-md-block">✈️ DIX Cargo</div>
    <div class="nav flex-column mt-2 gap-1 flex-grow-1">
      ${nav("/admin", "Дашборд", '<i class="bi bi-speedometer2"></i>')}
      ${nav("/admin/users", "Пользователи", '<i class="bi bi-people"></i>')}
      ${nav("/admin/packages", "Посылки", '<i class="bi bi-box-seam"></i>')}
      ${nav("/admin/marketplaces", "Маркетплейсы", '<i class="bi bi-shop"></i>')}
      ${nav("/admin/settings", "Настройки бота", '<i class="bi bi-gear"></i>')}
    </div>
    <div class="p-3 border-top border-secondary">
      <a href="/admin/logout" class="btn btn-outline-light btn-sm w-100">
        <i class="bi bi-box-arrow-right"></i> Выйти
      </a>
    </div>
  </nav>
  <main class="main flex-grow-1">
    <h4 class="mb-3 fw-bold">${title}</h4>
    ${body}
  </main>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
}

function loginPage(error = ""): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Вход — DIX Cargo Admin</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>
  <style>
    body { background:#1a1f36; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { border:none; border-radius:16px; width:100%; max-width:380px; box-shadow:0 8px 32px rgba(0,0,0,.3); }
  </style>
</head>
<body>
  <div class="card p-4">
    <div class="text-center mb-4">
      <div style="font-size:2rem">✈️</div>
      <h5 class="fw-bold mt-2">DIX Cargo Admin</h5>
    </div>
    ${error ? `<div class="alert alert-danger py-2">${error}</div>` : ""}
    <form method="POST" action="/admin/login">
      <div class="mb-3">
        <label class="form-label fw-semibold">Email</label>
        <input type="email" name="email" class="form-control" required autofocus/>
      </div>
      <div class="mb-3">
        <label class="form-label fw-semibold">Пароль</label>
        <div class="input-group">
          <input type="password" id="password" name="password" class="form-control" required/>
          <button type="button" class="btn btn-outline-secondary" id="togglePwd" tabindex="-1"
            style="border-color:#dee2e6">
            <svg id="eyeIcon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.1 13.1 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13.1 13.1 0 0 1 14.828 8a13.1 13.1 0 0 1-1.66 2.043C11.879 11.332 10.12 12.5 8 12.5s-3.879-1.168-5.168-2.457A13.1 13.1 0 0 1 1.172 8z"/>
              <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="mb-4 form-check">
        <input type="checkbox" class="form-check-input" id="remember" name="remember" value="1"/>
        <label class="form-check-label text-muted" for="remember">Запомнить меня на 30 дней</label>
      </div>
      <button class="btn btn-primary w-100 fw-semibold">Войти</button>
    </form>
  </div>
  <script>
    document.getElementById('togglePwd').addEventListener('click', function() {
      const pwd = document.getElementById('password');
      const isText = pwd.type === 'text';
      pwd.type = isText ? 'password' : 'text';
      document.getElementById('eyeIcon').innerHTML = isText
        ? '<path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.1 13.1 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13.1 13.1 0 0 1 14.828 8a13.1 13.1 0 0 1-1.66 2.043C11.879 11.332 10.12 12.5 8 12.5s-3.879-1.168-5.168-2.457A13.1 13.1 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>'
        : '<path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.03 7.03 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/><path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709z"/><path d="M13.646 14.354l-12-12 .708-.708 12 12-.708.708z"/>';
    });
  </script>
</body>
</html>`;
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.admin) return next();
  res.redirect("/admin/login");
}

// ── App ───────────────────────────────────────────────────────────────────────

async function notifyInOffice(bot: Bot<Context>, userId: number, clientCode: string, trackCode: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.telegram_id <= 0n) return;
    await bot.api.sendMessage(
      Number(user.telegram_id),
      `📦 Ваша посылка прибыла в офис!\n\n` +
      `🪪 Код клиента: <b>${clientCode}</b>\n` +
      `📬 Трек-номер: <b>${trackCode}</b>\n\n` +
      `Вы можете забрать её в рабочее время.`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("[Admin] Не удалось отправить уведомление пользователю:", err);
  }
}

export function createAdminApp(bot: Bot<Context>) {
  const app = express();

  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: COOKIE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
  }));

  // ── Login ──────────────────────────────────────────────────────────────────

  app.get("/admin/login", (_req, res) => res.send(loginPage()));

  app.post("/admin/login", (req, res) => {
    const { email, password, remember } = req.body as { email: string; password: string; remember?: string };
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      req.session.admin = true;
      if (remember === "1") {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      }
      return res.redirect("/admin");
    }
    res.send(loginPage("Неверный email или пароль"));
  });

  app.get("/admin/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/admin/login"));
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────

  app.get("/admin", requireAuth, async (_req, res) => {
    const now   = new Date();
    const sod   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sow   = new Date(sod); sow.setDate(sod.getDate() - sod.getDay() || 7);
    const som   = new Date(now.getFullYear(), now.getMonth(), 1);
    const soy   = new Date(now.getFullYear(), 0, 1);

    const since = (d: Date) => ({ gte: d });

    const [
      totalUsers, totalPackages,
      usersDay, usersWeek, usersMonth, usersYear,
      pkgDay, pkgWeek, pkgMonth, pkgYear,
      pkgOffice, pkgTransit, pkgDelivered,
      latestUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.package.count(),
      prisma.user.count({ where: { created_at: since(sod) } }),
      prisma.user.count({ where: { created_at: since(sow) } }),
      prisma.user.count({ where: { created_at: since(som) } }),
      prisma.user.count({ where: { created_at: since(soy) } }),
      prisma.package.count({ where: { created_at: since(sod) } }),
      prisma.package.count({ where: { created_at: since(sow) } }),
      prisma.package.count({ where: { created_at: since(som) } }),
      prisma.package.count({ where: { created_at: since(soy) } }),
      prisma.package.count({ where: { status: "IN_OFFICE" } }),
      prisma.package.count({ where: { status: "IN_TRANSIT" } }),
      prisma.package.count({ where: { status: "DELIVERED" } }),
      prisma.user.findMany({ orderBy: { created_at: "desc" }, take: 5 }),
    ]);

    const statCard = (label: string, value: number, color = "text-primary") =>
      `<div class="card stat-card p-3 h-100">
        <div class="text-muted small mb-1">${label}</div>
        <div class="fs-3 fw-bold ${color}">${value}</div>
      </div>`;

    const periodRow = (label: string, day: number, week: number, month: number, year: number) =>
      `<tr>
        <td class="fw-semibold">${label}</td>
        <td class="text-center">${day}</td>
        <td class="text-center">${week}</td>
        <td class="text-center">${month}</td>
        <td class="text-center">${year}</td>
      </tr>`;

    const userRows = latestUsers.map(u => `
      <tr>
        <td><span class="badge-code">${u.client_code}</span></td>
        <td>${u.full_name}</td>
        <td>${u.phone}</td>
        <td class="text-muted small">${u.created_at.toLocaleString("ru-RU")}</td>
        <td><a href="/admin/users/${u.id}" class="btn btn-sm btn-outline-primary">Открыть</a></td>
      </tr>`).join("");

    const body = `
      <div class="row g-3 mb-4">
        <div class="col-6 col-md-3">${statCard("Всего пользователей", totalUsers)}</div>
        <div class="col-6 col-md-3">${statCard("Всего посылок", totalPackages, "text-success")}</div>
        <div class="col-6 col-md-2">${statCard("🏢 В офисе", pkgOffice, "text-warning")}</div>
        <div class="col-6 col-md-2">${statCard("🚚 В пути", pkgTransit, "text-primary")}</div>
        <div class="col-6 col-md-2">${statCard("✅ Выдано", pkgDelivered, "text-success")}</div>
      </div>

      <div class="card stat-card mb-4">
        <div class="card-header bg-white fw-semibold">📊 Статистика за период</div>
        <div class="table-responsive">
          <table class="table mb-0 align-middle text-center">
            <thead>
              <tr class="table-light">
                <th class="text-start">Метрика</th>
                <th>День</th>
                <th>Неделя</th>
                <th>Месяц</th>
                <th>Год</th>
              </tr>
            </thead>
            <tbody>
              ${periodRow("👤 Новые пользователи", usersDay, usersWeek, usersMonth, usersYear)}
              ${periodRow("📦 Новые посылки",       pkgDay,   pkgWeek,   pkgMonth,   pkgYear)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card stat-card">
        <div class="card-header bg-white fw-semibold">Последние регистрации</div>
        <div class="table-responsive">
          <table class="table table-hover mb-0 align-middle">
            <thead><tr>
              <th>КОД</th><th>ФИО</th><th>Телефон</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody>${userRows || "<tr><td colspan='5' class='text-center text-muted py-4'>Нет данных</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;

    res.send(layout("Дашборд", body, "/admin"));
  });

  // ── Users list ─────────────────────────────────────────────────────────────

  app.get("/admin/users", requireAuth, async (req, res) => {
    const page  = Math.max(1, Number(req.query.page ?? 1));
    const limit = 20;
    const skip  = (page - 1) * limit;
    const q     = (req.query.q as string) ?? "";

    const where = q
      ? { OR: [
          { full_name:   { contains: q, mode: "insensitive" as const } },
          { phone:       { contains: q } },
          { client_code: { contains: q, mode: "insensitive" as const } },
        ]}
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { id: "desc" }, skip, take: limit }),
      prisma.user.count({ where }),
    ]);

    const pages = Math.ceil(total / limit);

    const rows = users.map(u => `
      <tr>
        <td><span class="badge-code">${u.client_code}</span></td>
        <td>${u.full_name}</td>
        <td>${u.phone}</td>
        <td class="text-muted small">${u.created_at.toLocaleString("ru-RU")}</td>
        <td>
          <a href="/admin/users/${u.id}" class="btn btn-sm btn-outline-primary me-1">
            <i class="bi bi-pencil"></i>
          </a>
          <form method="POST" action="/admin/users/${u.id}/delete" class="d-inline"
                onsubmit="return confirm('Удалить пользователя?')">
            <button class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button>
          </form>
        </td>
      </tr>`).join("");

    const pagination = pages > 1 ? `
      <nav class="mt-3"><ul class="pagination pagination-sm justify-content-end mb-0">
        ${Array.from({ length: pages }, (_, i) => i + 1).map(p => `
          <li class="page-item ${p === page ? "active" : ""}">
            <a class="page-link" href="?page=${p}&q=${encodeURIComponent(q)}">${p}</a>
          </li>`).join("")}
      </ul></nav>` : "";

    const body = `
      <div class="card stat-card">
        <div class="card-header bg-white d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-2">
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold">Пользователи <span class="badge bg-secondary">${total}</span></span>
            <a href="/admin/users/new" class="btn btn-sm btn-primary">
              <i class="bi bi-plus-lg"></i> Добавить
            </a>
          </div>
          <form method="GET" class="d-flex gap-2 flex-wrap w-100 w-sm-auto">
            <input name="q" value="${q}" class="form-control form-control-sm" placeholder="Поиск по имени, телефону, коду..." style="min-width:180px"/>
            <button class="btn btn-sm btn-outline-secondary">Найти</button>
            ${q ? `<a href="/admin/users" class="btn btn-sm btn-outline-secondary">Сброс</a>` : ""}
          </form>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0 align-middle">
            <thead><tr>
              <th>КОД</th><th>ФИО</th><th>Телефон</th><th>Дата регистрации</th><th></th>
            </tr></thead>
            <tbody>${rows || "<tr><td colspan='5' class='text-center text-muted py-4'>Нет пользователей</td></tr>"}</tbody>
          </table>
        </div>
        ${pagination ? `<div class="card-footer bg-white">${pagination}</div>` : ""}
      </div>`;

    res.send(layout("Пользователи", body, "/admin/users"));
  });

  // ── Create user ────────────────────────────────────────────────────────────

  app.get("/admin/users/new", requireAuth, (req, res) => {
    const phoneError = req.query.error === "phone";
    const body = `
      ${phoneError ? `<div class="alert alert-danger">Неверный формат телефона. Введите ровно 9 цифр, например: <b>500123123</b></div>` : ""}
      <div class="row">
        <div class="col-lg-6">
          <div class="card stat-card p-4">
            <form method="POST" action="/admin/users/new">
              <div class="mb-3">
                <label class="form-label fw-semibold">ФИО</label>
                <input name="full_name" class="form-control" required placeholder="Иванов Иван Иванович"/>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">Телефон</label>
                <input name="phone" id="phone" class="form-control" required
                  placeholder="500123123"
                  pattern="[0-9]{9}"
                  title="Введите 9 цифр без пробелов и символов, например: 500123123"
                  oninput="validatePhone(this)"/>
                <div class="form-text text-muted">Формат: 9 цифр, например <code>500123123</code></div>
                <div id="phone-error" class="invalid-feedback">Введите ровно 9 цифр (без +, пробелов и кода страны)</div>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">
                  Персональный КОД
                  <span class="text-muted fw-normal">(оставьте пустым — сгенерируется автоматически)</span>
                </label>
                <input name="client_code" class="form-control" placeholder="DIX-001"/>
              </div>
              <div class="mb-4">
                <label class="form-label fw-semibold">
                  Telegram ID
                  <span class="text-muted fw-normal">(необязательно)</span>
                </label>
                <input name="telegram_id" type="number" class="form-control" placeholder="123456789"/>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary fw-semibold">
                  <i class="bi bi-person-plus"></i> Создать
                </button>
                <a href="/admin/users" class="btn btn-outline-secondary">Отмена</a>
              </div>
            </form>
            <script>
              function validatePhone(el) {
                const valid = /^[0-9]{9}$/.test(el.value);
                el.classList.toggle('is-invalid', !valid && el.value.length > 0);
                el.classList.toggle('is-valid', valid);
              }
              document.querySelector('form').addEventListener('submit', function(e) {
                const el = document.getElementById('phone');
                if (!/^[0-9]{9}$/.test(el.value)) {
                  e.preventDefault();
                  el.classList.add('is-invalid');
                  el.focus();
                }
              });
            </script>
          </div>
        </div>
      </div>`;

    res.send(layout("Новый пользователь", body, "/admin/users"));
  });

  app.post("/admin/users/new", requireAuth, async (req, res) => {
    const { full_name, phone, client_code, telegram_id } =
      req.body as Record<string, string>;

    const cleanPhone = phone?.trim() ?? "";
    if (!/^[0-9]{9}$/.test(cleanPhone)) {
      return res.redirect("/admin/users/new?error=phone");
    }

    let code = client_code?.trim();
    if (!code) {
      code = await userService.generateUniqueClientCode();
    }

    const tgId = telegram_id?.trim()
      ? BigInt(telegram_id.trim())
      : BigInt(Date.now()) * -1n;

    const newUser = await prisma.user.create({
      data: {
        full_name: full_name.trim(),
        phone: cleanPhone,
        client_code: code,
        telegram_id: tgId,
      },
    });

    res.redirect(`/admin/users/${newUser.id}?saved=1`);
  });

  // ── User detail / edit ─────────────────────────────────────────────────────

  app.get("/admin/users/:id", requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!user) return res.redirect("/admin/users");

    const saved     = req.query.saved === "1";
    const dupCode   = req.query.error === "duplicate_code";
    const pkgSaved  = req.query.pkg_saved === "1";

    const packages = await prisma.package.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" },
    });

    const STATUS_LABEL: Record<string, string> = {
      IN_OFFICE:  "В офисе",
      IN_TRANSIT: "В пути",
      DELIVERED:  "Выдан",
    };
    const STATUS_BADGE: Record<string, string> = {
      IN_OFFICE:  "bg-warning text-dark",
      IN_TRANSIT: "bg-primary",
      DELIVERED:  "bg-success",
    };
    const statusOptions = (current: string) =>
      ["IN_TRANSIT", "IN_OFFICE", "DELIVERED"].map(s =>
        `<option value="${s}" ${s === current ? "selected" : ""}>${STATUS_LABEL[s]}</option>`
      ).join("");

    const pkgRows = packages.map(p => `
      <tr>
        <td class="text-center" style="width:40px">
          <input type="checkbox" name="ids" value="${p.id}" class="form-check-input pkg-cb">
        </td>
        <td class="font-monospace small">${p.track_code}</td>
        <td><span class="badge ${STATUS_BADGE[p.status]}">${STATUS_LABEL[p.status]}</span></td>
        <td class="text-muted small">${p.created_at.toLocaleDateString("ru-RU")}</td>
        <td class="text-muted small">${p.updated_at.toLocaleDateString("ru-RU")}</td>
      </tr>`).join("");

    const pkgSection = `
      <div class="card stat-card mt-4">
        <div class="card-header bg-white d-flex align-items-center justify-content-between flex-wrap gap-2">
          <span class="fw-semibold">Посылки <span class="badge bg-secondary">${packages.length}</span></span>
          ${pkgSaved ? `<span class="text-success small"><i class="bi bi-check-circle"></i> Статусы обновлены</span>` : ""}
        </div>
        ${packages.length === 0
          ? `<div class="p-4 text-muted text-center">Посылок нет</div>`
          : `<form method="POST" action="/admin/users/${user.id}/packages/status">
              <div class="table-responsive">
                <table class="table table-hover mb-0 align-middle">
                  <thead>
                    <tr>
                      <th class="text-center" style="width:40px">
                        <input type="checkbox" class="form-check-input" id="cb-all" title="Выбрать все">
                      </th>
                      <th>Трек-номер</th>
                      <th>Статус</th>
                      <th>Дата отправки</th>
                      <th>Дата поступления</th>
                    </tr>
                  </thead>
                  <tbody>${pkgRows}</tbody>
                </table>
              </div>
              <div class="card-footer bg-white d-flex align-items-center gap-2 flex-wrap">
                <span class="text-muted small" id="sel-count">Выбрано: 0</span>
                <select name="status" class="form-select form-select-sm" style="width:auto">
                  ${statusOptions("")}
                </select>
                <button class="btn btn-sm btn-primary fw-semibold" id="apply-btn" disabled>
                  <i class="bi bi-check2-all"></i> Применить к выбранным
                </button>
              </div>
            </form>`}
      </div>
      <script>
        const cbAll = document.getElementById('cb-all');
        const cbs = () => [...document.querySelectorAll('.pkg-cb')];
        const applyBtn = document.getElementById('apply-btn');
        const selCount = document.getElementById('sel-count');

        function updateState() {
          const checked = cbs().filter(c => c.checked).length;
          selCount.textContent = 'Выбрано: ' + checked;
          applyBtn.disabled = checked === 0;
          cbAll.indeterminate = checked > 0 && checked < cbs().length;
          cbAll.checked = checked === cbs().length && cbs().length > 0;
        }

        cbAll.addEventListener('change', () => {
          cbs().forEach(c => c.checked = cbAll.checked);
          updateState();
        });
        document.querySelectorAll('.pkg-cb').forEach(c =>
          c.addEventListener('change', updateState)
        );
      </script>`;

    const body = `
      ${saved    ? `<div class="alert alert-success">Изменения сохранены.</div>` : ""}
      ${dupCode  ? `<div class="alert alert-danger">Код клиента уже занят — введите другой.</div>` : ""}
      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card stat-card p-4">
            <form method="POST" action="/admin/users/${user.id}">
              <div class="mb-3">
                <label class="form-label fw-semibold">Персональный КОД</label>
                <input name="client_code" value="${user.client_code}" class="form-control" required/>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">ФИО</label>
                <input name="full_name" value="${user.full_name}" class="form-control" required/>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">Телефон</label>
                <input name="phone" value="${user.phone}" class="form-control" required/>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary fw-semibold">
                  <i class="bi bi-check-lg"></i> Сохранить
                </button>
                <a href="/admin/users" class="btn btn-outline-secondary">Назад</a>
              </div>
            </form>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="card stat-card p-4">
            <div class="text-muted small fw-semibold mb-3 text-uppercase">Информация</div>
            <dl class="mb-0 small">
              <dt class="text-muted">Telegram ID</dt>
              <dd class="font-monospace">${user.telegram_id.toString()}</dd>
              <dt class="text-muted">Дата регистрации</dt>
              <dd>${user.created_at.toLocaleString("ru-RU")}</dd>
              <dt class="text-muted">Последнее обновление</dt>
              <dd>${user.updated_at.toLocaleString("ru-RU")}</dd>
            </dl>
          </div>
          <div class="card stat-card p-4 mt-3 border-danger">
            <div class="text-danger fw-semibold mb-2 small">Опасная зона</div>
            <form method="POST" action="/admin/users/${user.id}/delete"
                  onsubmit="return confirm('Удалить пользователя ${user.full_name}?')">
              <button class="btn btn-outline-danger btn-sm w-100">
                <i class="bi bi-trash"></i> Удалить пользователя
              </button>
            </form>
          </div>
        </div>
      </div>
      ${pkgSection}`;

    res.send(layout(user.full_name, body, "/admin/users"));
  });

  app.post("/admin/users/:id/packages/status", requireAuth, async (req, res) => {
    const userId = Number(req.params.id);
    const { ids, status } = req.body as { ids: string | string[]; status: string };
    const validStatuses = ["IN_TRANSIT", "IN_OFFICE", "DELIVERED"];
    if (!validStatuses.includes(status)) return res.redirect(`/admin/users/${userId}`);

    const idList = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
    if (idList.length > 0) {
      await prisma.package.updateMany({
        where: { id: { in: idList }, user_id: userId },
        data:  { status: status as "IN_TRANSIT" | "IN_OFFICE" | "DELIVERED" },
      });

      if (status === "IN_OFFICE") {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const packages = await prisma.package.findMany({ where: { id: { in: idList } } });
        for (const pkg of packages) {
          await notifyInOffice(bot, userId, user?.client_code ?? "—", pkg.track_code);
        }
      }
    }
    res.redirect(`/admin/users/${userId}?pkg_saved=1`);
  });

  // ── Update user ────────────────────────────────────────────────────────────

  app.post("/admin/users/:id", requireAuth, async (req, res) => {
    const { client_code, full_name, phone } = req.body as Record<string, string>;

    try {
      await prisma.user.update({
        where: { id: Number(req.params.id) },
        data: { client_code, full_name, phone },
      });
      res.redirect(`/admin/users/${req.params.id}?saved=1`);
    } catch (e: any) {
      if (e?.code === "P2002") {
        res.redirect(`/admin/users/${req.params.id}?error=duplicate_code`);
      } else {
        throw e;
      }
    }
  });

  // ── Delete user ────────────────────────────────────────────────────────────

  app.post("/admin/users/:id/delete", requireAuth, async (req, res) => {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.redirect("/admin/users");
  });

  // ── Excel import ──────────────────────────────────────────────────────────

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.get("/admin/packages/import", requireAuth, (_req, res) => {
    const body = `
      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card stat-card p-4">
            <p class="text-muted small mb-3">
              Колонка <b>C</b> — код клиента. Форматы: <code>2222</code>, <code>DIX2222</code>, <code>DIX-2222</code>, <code>DIX 2222</code>.<br>
              Колонка <b>D</b> — трек-номер.<br>
              Строки без распознанного кода в колонке C пропускаются.<br>
              Дата отправки извлекается из имени файла (формат: <code>4月18号…</code>).<br>
              Если дата не найдена — используется сегодняшняя.
            </p>
            <form method="POST" action="/admin/packages/import" enctype="multipart/form-data">
              <div class="mb-4">
                <label class="form-label fw-semibold">Excel файл (.xlsx)</label>
                <input type="file" name="file" accept=".xlsx" class="form-control" required/>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary fw-semibold">
                  <i class="bi bi-upload"></i> Импортировать
                </button>
                <a href="/admin/packages" class="btn btn-outline-secondary">Отмена</a>
              </div>
            </form>
          </div>
        </div>
      </div>`;

    res.send(layout("Импорт посылок из Excel", body, "/admin/packages"));
  });

  app.post("/admin/packages/import", requireAuth, upload.single("file"), async (req, res) => {
    if (!req.file) return res.redirect("/admin/packages/import");

    // Extract shipping date from filename: "4月18号" → month=4, day=18
    const filename = req.file.originalname;
    const dateMatch = filename.match(/(\d+)月(\d+)号/);
    let shippingDate: Date;
    if (dateMatch) {
      const month = parseInt(dateMatch[1], 10) - 1;
      const day   = parseInt(dateMatch[2], 10);
      shippingDate = new Date(new Date().getFullYear(), month, day);
    } else {
      shippingDate = new Date();
    }

    // Parse Excel — column C (index 2) = client code, column D (index 3) = track code
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

    let imported = 0, skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const rawCode   = (row as unknown[])[2];
      const trackCode = String((row as unknown[])[3] ?? "").trim();

      const clientCode = parseClientCode(rawCode);

      // Skip rows without a recognisable DIX code in column C or empty track in column D
      if (!clientCode || !trackCode) continue;

      const user = await prisma.user.findUnique({ where: { client_code: clientCode } });
      if (!user) { errors.push(`${clientCode}: пользователь не найден`); skipped++; continue; }

      // Skip if this track code already exists for this user (any status, including DELIVERED)
      const exists = await prisma.package.findFirst({
        where: { user_id: user.id, track_code: trackCode },
      });
      if (exists) { skipped++; continue; }

      await prisma.package.create({
        data: {
          user_id:    user.id,
          track_code: trackCode,
          status:     "IN_TRANSIT",
          created_at: shippingDate,
        },
      });
      imported++;
    }

    const msg = `Импортировано: <b>${imported}</b> посылок. Пропущено: ${skipped}.` +
      (errors.length ? `<br><small class="text-muted">${errors.slice(0, 10).join("<br>")}</small>` : "");

    res.send(layout("Импорт посылок из Excel",
      `<div class="alert alert-success">${msg}</div>
       <a href="/admin/packages" class="btn btn-primary">К списку посылок</a>`,
      "/admin/packages"
    ));
  });

  // ── Packages list ─────────────────────────────────────────────────────────

  app.get("/admin/packages", requireAuth, async (req, res) => {
    const PAGE_SIZE = 25;
    const page    = Math.max(1, parseInt(req.query.page as string) || 1);
    const search  = ((req.query.search as string) ?? "").trim();
    const statusQ = (req.query.status as string) ?? "";
    const dateFrom = (req.query.date_from as string) ?? "";
    const dateTo   = (req.query.date_to   as string) ?? "";
    const tab      = (req.query.tab as string) === "archive" ? "archive" : "active";

    const where: Record<string, unknown> = {};
    if (search)  where.track_code = { contains: search, mode: "insensitive" };

    if (tab === "archive") {
      where.status = "DELIVERED";
    } else {
      // Active tab: exclude DELIVERED unless admin explicitly filters by it
      where.status = statusQ && statusQ !== "DELIVERED" ? statusQ : { not: "DELIVERED" };
    }

    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo)   range.lte = new Date(dateTo + "T23:59:59.999Z");
      where.created_at = range;
    }

    const [packages, total] = await Promise.all([
      prisma.package.findMany({
        where,
        include: { user: { select: { client_code: true, full_name: true } } },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.package.count({ where }),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    const STATUS_LABEL: Record<string, string> = {
      IN_OFFICE:  "🏢 В офисе",
      IN_TRANSIT: "🚚 В пути",
      DELIVERED:  "✅ Выдан",
    };
    const STATUS_BADGE: Record<string, string> = {
      IN_OFFICE:  "bg-warning text-dark",
      IN_TRANSIT: "bg-primary",
      DELIVERED:  "bg-success",
    };

    const qs = (extra: Record<string, unknown>) => {
      const p = new URLSearchParams({ search, status: statusQ, date_from: dateFrom, date_to: dateTo, tab, page: String(page), ...extra });
      return "?" + p.toString();
    };

    const activeCount  = await prisma.package.count({ where: { status: { not: "DELIVERED" } } });
    const archiveCount = await prisma.package.count({ where: { status: "DELIVERED" } });

    const tabs = `
      <ul class="nav nav-tabs mb-3">
        <li class="nav-item">
          <a class="nav-link ${tab === "active" ? "active fw-semibold" : ""}"
             href="/admin/packages?tab=active">
            📦 Активные <span class="badge ${tab === "active" ? "bg-primary" : "bg-secondary"}">${activeCount}</span>
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link ${tab === "archive" ? "active fw-semibold" : ""}"
             href="/admin/packages?tab=archive">
            🗂 Архив <span class="badge ${tab === "archive" ? "bg-primary" : "bg-secondary"}">${archiveCount}</span>
          </a>
        </li>
      </ul>`;

    const statusOptions = tab === "active"
      ? [
          ["", "Все активные"],
          ["IN_TRANSIT", "🚚 В пути"],
          ["IN_OFFICE",  "🏢 В офисе"],
        ].map(([v, l]) =>
          `<option value="${v}" ${statusQ === v ? "selected" : ""}>${l}</option>`
        ).join("")
      : "";

    const rows = packages.map((p) => `
      <tr>
        <td class="font-monospace">${p.track_code}</td>
        <td><span class="badge ${STATUS_BADGE[p.status]}">${STATUS_LABEL[p.status]}</span></td>
        <td><span class="badge-code">${p.user.client_code}</span></td>
        <td class="small text-muted">${p.user.full_name}</td>
        <td class="text-muted small">${p.created_at.toLocaleString("ru-RU")}</td>
        <td><a href="/admin/packages/${p.id}" class="btn btn-sm btn-outline-primary">Открыть</a></td>
      </tr>`).join("");

    const pagination = totalPages > 1 ? `
      <nav class="mt-3">
        <ul class="pagination pagination-sm mb-0 justify-content-center">
          <li class="page-item ${page <= 1 ? "disabled" : ""}">
            <a class="page-link" href="${qs({ page: page - 1 })}">‹</a>
          </li>
          ${Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => `
            <li class="page-item ${p === page ? "active" : ""}">
              <a class="page-link" href="${qs({ page: p })}">${p}</a>
            </li>`).join("")}
          <li class="page-item ${page >= totalPages ? "disabled" : ""}">
            <a class="page-link" href="${qs({ page: page + 1 })}">›</a>
          </li>
        </ul>
      </nav>` : "";

    const body = `
      ${tabs}
      <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
        <span class="text-muted">${total} посылок</span>
        <div class="d-flex gap-2 flex-wrap">
          <a href="/admin/packages/import" class="btn btn-outline-success btn-sm">
            <i class="bi bi-file-earmark-excel"></i> Импорт Excel
          </a>
          ${tab === "active" ? `<a href="/admin/packages/new" class="btn btn-primary btn-sm"><i class="bi bi-plus-lg"></i> Добавить</a>` : ""}
        </div>
      </div>
      <form method="GET" action="/admin/packages" class="row g-2 mb-3">
        <input type="hidden" name="tab" value="${tab}">
        <div class="col-12 col-sm">
          <input name="search" value="${search}" class="form-control" placeholder="🔍 Поиск по трек-номеру…"/>
        </div>
        ${tab === "active" ? `<div class="col-6 col-sm-auto"><select name="status" class="form-select">${statusOptions}</select></div>` : ""}
        <div class="col-6 col-sm-auto">
          <input type="date" name="date_from" value="${dateFrom}" class="form-control" title="Дата от">
        </div>
        <div class="col-6 col-sm-auto">
          <input type="date" name="date_to" value="${dateTo}" class="form-control" title="Дата до">
        </div>
        <div class="col-6 col-sm-auto d-flex gap-2">
          <button class="btn btn-outline-primary flex-fill">Найти</button>
          <a href="/admin/packages" class="btn btn-outline-secondary flex-fill">Сброс</a>
        </div>
      </form>
      <div class="card stat-card">
        <div class="table-responsive">
          <table class="table table-hover mb-0 align-middle">
            <thead><tr>
              <th>Трек-код</th><th>Статус</th><th>DIX-код</th><th>Клиент</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody>${rows || "<tr><td colspan='6' class='text-center text-muted py-4'>Нет посылок</td></tr>"}</tbody>
          </table>
        </div>
        ${pagination}
      </div>`;

    res.send(layout("Посылки", body, "/admin/packages"));
  });

  // ── Package new ────────────────────────────────────────────────────────────

  app.get("/admin/packages/new", requireAuth, async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { client_code: "asc" },
      select: { id: true, client_code: true, full_name: true },
    });

    const options = users.map((u) =>
      `<option value="${u.id}">${u.client_code} — ${u.full_name}</option>`
    ).join("");

    const body = `
      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card stat-card p-4">
            <form method="POST" action="/admin/packages/new">
              <div class="mb-3">
                <label class="form-label fw-semibold">Клиент</label>
                <select name="user_id" class="form-select" required>${options}</select>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">Трек-код</label>
                <input name="track_code" class="form-control font-monospace" required placeholder="RU123456789CN"/>
              </div>
              <div class="mb-4">
                <label class="form-label fw-semibold">Статус</label>
                <select name="status" class="form-select">
                  <option value="IN_TRANSIT">🚚 В пути</option>
                  <option value="IN_OFFICE">🏢 В офисе</option>
                  <option value="DELIVERED">✅ Выдан</option>
                </select>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary fw-semibold">
                  <i class="bi bi-plus-lg"></i> Добавить
                </button>
                <a href="/admin/packages" class="btn btn-outline-secondary">Отмена</a>
              </div>
            </form>
          </div>
        </div>
      </div>`;

    res.send(layout("Новая посылка", body, "/admin/packages"));
  });

  app.post("/admin/packages/new", requireAuth, async (req, res) => {
    const { user_id, track_code, status } = req.body as Record<string, string>;

    await prisma.package.create({
      data: {
        user_id: Number(user_id),
        track_code: track_code.trim(),
        status: status as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED",
      },
    });

    res.redirect("/admin/packages");
  });

  // ── Package detail / edit ──────────────────────────────────────────────────

  app.get("/admin/packages/:id", requireAuth, async (req, res) => {
    const pkg = await prisma.package.findUnique({
      where: { id: Number(req.params.id) },
      include: { user: { select: { client_code: true, full_name: true } } },
    });
    if (!pkg) return res.redirect("/admin/packages");

    const saved = req.query.saved === "1";

    const body = `
      ${saved ? `<div class="alert alert-success">Изменения сохранены.</div>` : ""}
      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card stat-card p-4">
            <form method="POST" action="/admin/packages/${pkg.id}">
              <div class="mb-3">
                <label class="form-label fw-semibold">Трек-код</label>
                <input name="track_code" value="${pkg.track_code}" class="form-control font-monospace" required/>
              </div>
              <div class="mb-4">
                <label class="form-label fw-semibold">Статус</label>
                <select name="status" class="form-select">
                  <option value="IN_TRANSIT" ${pkg.status === "IN_TRANSIT" ? "selected" : ""}>🚚 В пути</option>
                  <option value="IN_OFFICE"  ${pkg.status === "IN_OFFICE"  ? "selected" : ""}>🏢 В офисе</option>
                  <option value="DELIVERED"  ${pkg.status === "DELIVERED"  ? "selected" : ""}>✅ Выдан</option>
                </select>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-primary fw-semibold">
                  <i class="bi bi-check-lg"></i> Сохранить
                </button>
                <a href="/admin/packages" class="btn btn-outline-secondary">Назад</a>
              </div>
            </form>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="card stat-card p-4">
            <div class="text-muted small fw-semibold mb-3 text-uppercase">Информация</div>
            <dl class="mb-0 small">
              <dt class="text-muted">Клиент</dt>
              <dd><span class="badge-code">${pkg.user.client_code}</span> ${pkg.user.full_name}</dd>
              <dt class="text-muted">Дата добавления</dt>
              <dd>${pkg.created_at.toLocaleString("ru-RU")}</dd>
              <dt class="text-muted">Последнее изменение</dt>
              <dd>${pkg.updated_at.toLocaleString("ru-RU")}</dd>
            </dl>
          </div>
          <div class="card stat-card p-4 mt-3 border-danger">
            <div class="text-danger fw-semibold mb-2 small">Опасная зона</div>
            <form method="POST" action="/admin/packages/${pkg.id}/delete"
                  onsubmit="return confirm('Удалить посылку ${pkg.track_code}?')">
              <button class="btn btn-outline-danger btn-sm w-100">
                <i class="bi bi-trash"></i> Удалить посылку
              </button>
            </form>
          </div>
        </div>
      </div>`;

    res.send(layout(pkg.track_code, body, "/admin/packages"));
  });

  app.post("/admin/packages/:id", requireAuth, async (req, res) => {
    const { track_code, status } = req.body as Record<string, string>;

    const pkg = await prisma.package.update({
      where: { id: Number(req.params.id) },
      data: {
        track_code: track_code.trim(),
        status: status as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED",
      },
      include: { user: true },
    });

    if (status === "IN_OFFICE") {
      await notifyInOffice(bot, pkg.user_id, pkg.user.client_code, pkg.track_code);
    }

    res.redirect(`/admin/packages/${req.params.id}?saved=1`);
  });

  app.post("/admin/packages/:id/delete", requireAuth, async (req, res) => {
    await prisma.package.delete({ where: { id: Number(req.params.id) } });
    res.redirect("/admin/packages");
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  app.get("/admin/settings", requireAuth, async (req, res) => {
    const saved = req.query.saved === "1";
    const settings = await prisma.setting.findMany({
      where: { key: { in: ["forbidden_items", "manager_1_name", "manager_1_url", "manager_2_name", "manager_2_url"] } },
    });
    const s: Record<string, string> = {};
    for (const row of settings) s[row.key] = row.value;

    const body = `
      ${saved ? `<div class="alert alert-success">Изменения сохранены.</div>` : ""}
      <div class="row g-4">
        <div class="col-lg-8">
          <div class="card stat-card p-4 mb-4">
            <form method="POST" action="/admin/settings">
              <h5 class="fw-bold mb-3">👥 Кнопки менеджеров</h5>
              <div class="row g-3 mb-4">
                <div class="col-sm-3">
                  <label class="form-label fw-semibold">Менеджер 1 — имя</label>
                  <input type="text" name="manager_1_name" class="form-control" value="${s.manager_1_name ?? "Лидия"}" placeholder="Лидия">
                </div>
                <div class="col-sm-9">
                  <label class="form-label fw-semibold">Менеджер 1 — ссылка</label>
                  <input type="url" name="manager_1_url" class="form-control" value="${s.manager_1_url ?? "https://wa.me/996550867414"}" placeholder="https://wa.me/...">
                </div>
                <div class="col-sm-3">
                  <label class="form-label fw-semibold">Менеджер 2 — имя</label>
                  <input type="text" name="manager_2_name" class="form-control" value="${s.manager_2_name ?? "Виктория"}" placeholder="Виктория">
                </div>
                <div class="col-sm-9">
                  <label class="form-label fw-semibold">Менеджер 2 — ссылка</label>
                  <input type="url" name="manager_2_url" class="form-control" value="${s.manager_2_url ?? "https://wa.me/996556969906"}" placeholder="https://wa.me/...">
                </div>
              </div>
              <hr class="my-4">
              <h5 class="fw-bold mb-3">🚫 Запрещённые товары</h5>
              <div class="mb-3">
                <label class="form-label text-muted small">Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;code&gt;)</label>
                <textarea name="forbidden_items" class="form-control font-monospace" rows="18" required>${s.forbidden_items ?? ""}</textarea>
              </div>
              <button class="btn btn-primary fw-semibold">
                <i class="bi bi-check-lg"></i> Сохранить
              </button>
            </form>
          </div>
        </div>
      </div>`;

    res.send(layout("Настройки бота", body, "/admin/settings"));
  });

  app.post("/admin/settings", requireAuth, async (req, res) => {
    const body = req.body as Record<string, string>;
    const keys = ["forbidden_items", "manager_1_name", "manager_1_url", "manager_2_name", "manager_2_url"];
    for (const key of keys) {
      if (typeof body[key] === "string") {
        await prisma.setting.upsert({
          where:  { key },
          update: { value: body[key] },
          create: { key, value: body[key] },
        });
      }
    }
    res.redirect("/admin/settings?saved=1");
  });

  // ── Маркетплейсы ──────────────────────────────────────────────────────────

  const MARKETPLACE_KEYS = [
    { key: "marketplace_pinduoduo", label: "Pinduoduo" },
    { key: "marketplace_taobao",    label: "TaoBao" },
    { key: "marketplace_1688",      label: "1688" },
    { key: "marketplace_poizon",    label: "Poizon" },
  ];

  const MARKETPLACE_DEFAULTS: Record<string, string> = {
    marketplace_pinduoduo:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
    marketplace_taobao:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
    marketplace_1688:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
    marketplace_poizon:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
  };

  const UPLOADS_DIR = "/app/uploads";

  const marketplaceUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        cb(null, UPLOADS_DIR);
      },
      filename: (req, file, cb) => {
        const fieldname = file.fieldname; // e.g. "pinduoduo_photo" or "pinduoduo_video"
        const ext = path.extname(file.originalname).toLowerCase() || (file.mimetype.startsWith("video") ? ".mp4" : ".jpg");
        // Delete any previous file for this field
        const prefix = fieldname;
        try {
          const existing = fs.readdirSync(UPLOADS_DIR).filter(f => f.startsWith(prefix + "."));
          for (const f of existing) fs.unlinkSync(path.join(UPLOADS_DIR, f));
        } catch {}
        cb(null, `${fieldname}${ext}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  const marketplaceFields = MARKETPLACE_KEYS.flatMap(({ key }) => {
    const name = key.replace("marketplace_", "");
    return [
      { name: `${name}_photo`, maxCount: 1 },
      { name: `${name}_video`, maxCount: 1 },
    ];
  });

  app.get("/admin/marketplaces", requireAuth, async (req, res) => {
    const saved = req.query.saved === "1";
    const settings = await prisma.setting.findMany({
      where: { key: { in: MARKETPLACE_KEYS.map(m => m.key) } },
    });
    const valueMap: Record<string, string> = {};
    for (const s of settings) valueMap[s.key] = s.value;

    let uploadedFiles: string[] = [];
    try { uploadedFiles = fs.readdirSync(UPLOADS_DIR); } catch {}

    const hasFile = (prefix: string) => uploadedFiles.some(f => f.startsWith(prefix + "."));

    const fileZone = (fieldName: string, accept: string, icon: string, hasUploaded: boolean) => `
      <div class="file-drop-zone" id="zone-${fieldName}" onclick="document.getElementById('inp-${fieldName}').click()">
        <input type="file" id="inp-${fieldName}" name="${fieldName}" accept="${accept}" class="d-none" onchange="previewFile(this,'zone-${fieldName}')">
        <div class="file-drop-inner">
          <i class="bi ${icon} file-drop-icon"></i>
          <div class="file-drop-text">Нажмите или перетащите файл</div>
          <div class="file-drop-hint">${hasUploaded ? '<span class="badge bg-success">уже загружено</span>' : '<span class="badge bg-secondary">дефолт</span>'}</div>
        </div>
      </div>`;

    const sections = MARKETPLACE_KEYS.map(({ key, label }) => {
      const name = key.replace("marketplace_", "");
      const value = (valueMap[key] ?? MARKETPLACE_DEFAULTS[key] ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `
        <div class="mb-5 pb-4 border-bottom">
          <h5 class="fw-bold mb-3">${label}</h5>
          <div class="mb-3">
            <label class="form-label fw-semibold">Текст сообщения</label>
            <div class="text-muted small mb-1">Поддерживает HTML-теги Telegram (&lt;b&gt;, &lt;i&gt;, &lt;code&gt;). Используйте <code>{code}</code> для кода клиента.</div>
            <textarea name="${key}" class="form-control font-monospace" rows="7">${value}</textarea>
          </div>
          <div class="row g-3">
            <div class="col-sm-6">
              <label class="form-label fw-semibold mb-2">📷 Фото</label>
              ${fileZone(`${name}_photo`, "image/*", "bi-image", hasFile(`${name}_photo`))}
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold mb-2">🎬 Видео</label>
              ${fileZone(`${name}_video`, "video/*", "bi-camera-video", hasFile(`${name}_video`))}
            </div>
          </div>
        </div>`;
    }).join("");

    const fileDropStyles = `
      <style>
        .file-drop-zone {
          border: 2px dashed #ced4da;
          border-radius: 12px;
          padding: 1.5rem 1rem;
          text-align: center;
          cursor: pointer;
          transition: border-color .2s, background .2s;
          background: #f8f9fa;
          user-select: none;
        }
        .file-drop-zone:hover, .file-drop-zone.drag-over {
          border-color: #4e6ef2;
          background: #eef0fd;
        }
        .file-drop-zone.has-file {
          border-color: #198754;
          background: #f0faf4;
        }
        .file-drop-icon {
          font-size: 2rem;
          color: #adb5bd;
          display: block;
          margin-bottom: .5rem;
          transition: color .2s;
        }
        .file-drop-zone:hover .file-drop-icon,
        .file-drop-zone.drag-over .file-drop-icon { color: #4e6ef2; }
        .file-drop-zone.has-file .file-drop-icon { color: #198754; }
        .file-drop-text { font-size: .875rem; color: #495057; font-weight: 500; }
        .file-drop-hint { font-size: .75rem; color: #6c757d; margin-top: .35rem; }
        .file-drop-filename { font-size: .8rem; color: #198754; font-weight: 600; margin-top: .4rem; word-break: break-all; }
      </style>`;

    const fileDropScript = `
      <script>
        function previewFile(input, zoneId) {
          const zone = document.getElementById(zoneId);
          const file = input.files[0];
          if (!file) return;
          zone.classList.add('has-file');
          let hint = zone.querySelector('.file-drop-hint');
          hint.innerHTML = '<span class="badge bg-success">выбрано</span>';
          let name = zone.querySelector('.file-drop-filename');
          if (!name) { name = document.createElement('div'); name.className = 'file-drop-filename'; zone.querySelector('.file-drop-inner').appendChild(name); }
          name.textContent = file.name;
        }
        document.querySelectorAll('.file-drop-zone').forEach(zone => {
          zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
          zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
          zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const id = zone.id.replace('zone-', 'inp-');
            const input = document.getElementById(id);
            const dt = e.dataTransfer;
            if (dt.files.length) { input.files = dt.files; previewFile(input, zone.id); }
          });
        });
      </script>`;

    const body = `
      ${fileDropStyles}
      ${saved ? `<div class="alert alert-success">Изменения сохранены.</div>` : ""}
      <div class="row g-4">
        <div class="col-lg-9">
          <div class="card stat-card p-4">
            <form method="POST" action="/admin/marketplaces" enctype="multipart/form-data">
              ${sections}
              <button class="btn btn-primary fw-semibold">
                <i class="bi bi-check-lg"></i> Сохранить все
              </button>
            </form>
          </div>
        </div>
      </div>
      ${fileDropScript}`;

    res.send(layout("Маркетплейсы", body, "/admin/marketplaces"));
  });

  app.post("/admin/marketplaces", requireAuth, marketplaceUpload.fields(marketplaceFields), async (req, res) => {
    const body = req.body as Record<string, string>;
    for (const { key } of MARKETPLACE_KEYS) {
      if (typeof body[key] === "string") {
        await prisma.setting.upsert({
          where:  { key },
          update: { value: body[key] },
          create: { key, value: body[key] },
        });
      }
    }
    res.redirect("/admin/marketplaces?saved=1");
  });

  // ── Root redirect ──────────────────────────────────────────────────────────

  app.get("/", (_req, res) => res.redirect("/admin"));

  return { app, port: PORT };
}
