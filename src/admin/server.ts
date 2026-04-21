import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import prisma from "../database/prismaClient";

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
    .sidebar { width:240px; min-height:100vh; background:#1a1f36; }
    .sidebar .brand { font-size:1.25rem; font-weight:700; color:#fff; padding:1.5rem 1rem; border-bottom:1px solid #2d3561; }
    .sidebar .nav-link { padding:.6rem 1rem; border-radius:6px; margin:.1rem .5rem; }
    .sidebar .nav-link.active { background:#4e6ef2; color:#fff !important; }
    .sidebar .nav-link:hover:not(.active) { background:#2d3561; color:#fff !important; }
    .main { flex:1; padding:2rem; }
    .stat-card { border:none; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.07); }
    .table th { background:#f8f9fa; font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
    .badge-code { background:#e8edff; color:#4e6ef2; font-family:monospace; font-size:.85rem; padding:.3em .6em; border-radius:6px; }
  </style>
</head>
<body>
<div class="d-flex">
  <nav class="sidebar d-flex flex-column p-0">
    <div class="brand">✈️ DIX Cargo</div>
    <div class="nav flex-column mt-2 gap-1 flex-grow-1">
      ${nav("/admin", "Дашборд", '<i class="bi bi-speedometer2"></i>')}
      ${nav("/admin/users", "Пользователи", '<i class="bi bi-people"></i>')}
    </div>
    <div class="p-3 border-top border-secondary">
      <a href="/admin/logout" class="btn btn-outline-light btn-sm w-100">
        <i class="bi bi-box-arrow-right"></i> Выйти
      </a>
    </div>
  </nav>
  <main class="main">
    <h4 class="mb-4 fw-bold">${title}</h4>
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
      <div class="mb-4">
        <label class="form-label fw-semibold">Пароль</label>
        <input type="password" name="password" class="form-control" required/>
      </div>
      <button class="btn btn-primary w-100 fw-semibold">Войти</button>
    </form>
  </div>
</body>
</html>`;
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.admin) return next();
  res.redirect("/admin/login");
}

// ── App ───────────────────────────────────────────────────────────────────────

export function createAdminApp() {
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
    const { email, password } = req.body as { email: string; password: string };
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      req.session.admin = true;
      return res.redirect("/admin");
    }
    res.send(loginPage("Неверный email или пароль"));
  });

  app.get("/admin/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/admin/login"));
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────

  app.get("/admin", requireAuth, async (_req, res) => {
    const [totalUsers, latestUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({ orderBy: { created_at: "desc" }, take: 5 }),
    ]);

    const rows = latestUsers.map(u => `
      <tr>
        <td><span class="badge-code">${u.client_code}</span></td>
        <td>${u.full_name}</td>
        <td>${u.phone}</td>
        <td class="text-muted small">${u.created_at.toLocaleString("ru-RU")}</td>
        <td><a href="/admin/users/${u.id}" class="btn btn-sm btn-outline-primary">Открыть</a></td>
      </tr>`).join("");

    const body = `
      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card stat-card p-3">
            <div class="text-muted small">Всего пользователей</div>
            <div class="fs-2 fw-bold text-primary">${totalUsers}</div>
          </div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="card-header bg-white fw-semibold">Последние регистрации</div>
        <div class="table-responsive">
          <table class="table table-hover mb-0 align-middle">
            <thead><tr>
              <th>КОД</th><th>ФИО</th><th>Телефон</th><th>Дата</th><th></th>
            </tr></thead>
            <tbody>${rows || "<tr><td colspan='5' class='text-center text-muted py-4'>Нет данных</td></tr>"}</tbody>
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
        <div class="card-header bg-white d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold">Пользователи <span class="badge bg-secondary">${total}</span></span>
            <a href="/admin/users/new" class="btn btn-sm btn-primary">
              <i class="bi bi-plus-lg"></i> Добавить
            </a>
          </div>
          <form method="GET" class="d-flex gap-2">
            <input name="q" value="${q}" class="form-control form-control-sm" placeholder="Поиск по имени, телефону, коду..." style="width:280px"/>
            <button class="btn btn-sm btn-outline-secondary">Найти</button>
            ${q ? `<a href="/admin/users" class="btn btn-sm btn-outline-secondary">Сбросить</a>` : ""}
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

  app.get("/admin/users/new", requireAuth, (_req, res) => {
    const body = `
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
                <input name="phone" class="form-control" required placeholder="996700000000"/>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">
                  Персональный КОД
                  <span class="text-muted fw-normal">(оставьте пустым — сгенерируется автоматически)</span>
                </label>
                <input name="client_code" class="form-control" placeholder="DIX-001"/>
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold">Пароль</label>
                <input name="password" type="text" class="form-control" required/>
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
          </div>
        </div>
      </div>`;

    res.send(layout("Новый пользователь", body, "/admin/users"));
  });

  app.post("/admin/users/new", requireAuth, async (req, res) => {
    const { full_name, phone, password, client_code, telegram_id } =
      req.body as Record<string, string>;

    const { createHash } = await import("crypto");
    const passwordHash = createHash("sha256").update(password.trim()).digest("hex");

    let code = client_code?.trim();
    if (!code) {
      const lastUser = await prisma.user.findFirst({
        orderBy: { id: "desc" },
        select: { client_code: true },
      });
      const lastNumber = lastUser
        ? parseInt(lastUser.client_code.split("-")[1] ?? "0", 10)
        : 0;
      code = `DIX-${String(lastNumber + 1).padStart(3, "0")}`;
    }

    const tgId = telegram_id?.trim()
      ? BigInt(telegram_id.trim())
      : BigInt(Date.now()) * -1n;

    const newUser = await prisma.user.create({
      data: {
        full_name: full_name.trim(),
        phone: phone.trim(),
        password: passwordHash,
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

    const saved = req.query.saved === "1";

    const body = `
      ${saved ? `<div class="alert alert-success">Изменения сохранены.</div>` : ""}
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
              <div class="mb-4">
                <label class="form-label fw-semibold">Новый пароль <span class="text-muted fw-normal">(оставьте пустым — без изменений)</span></label>
                <input name="password" type="text" class="form-control" placeholder="Введите новый пароль..."/>
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
      </div>`;

    res.send(layout(user.full_name, body, "/admin/users"));
  });

  // ── Update user ────────────────────────────────────────────────────────────

  app.post("/admin/users/:id", requireAuth, async (req, res) => {
    const { client_code, full_name, phone, password } = req.body as Record<string, string>;

    const data: Record<string, string> = { client_code, full_name, phone };

    if (password?.trim()) {
      const { createHash } = await import("crypto");
      data.password = createHash("sha256").update(password.trim()).digest("hex");
    }

    await prisma.user.update({ where: { id: Number(req.params.id) }, data });
    res.redirect(`/admin/users/${req.params.id}?saved=1`);
  });

  // ── Delete user ────────────────────────────────────────────────────────────

  app.post("/admin/users/:id/delete", requireAuth, async (req, res) => {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.redirect("/admin/users");
  });

  // ── Root redirect ──────────────────────────────────────────────────────────

  app.get("/", (_req, res) => res.redirect("/admin"));

  return { app, port: PORT };
}
