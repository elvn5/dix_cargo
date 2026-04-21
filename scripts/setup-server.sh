#!/bin/bash
# Запускать один раз на новом сервере:
# bash setup-server.sh
set -e

echo "==> Обновляем пакеты..."
apt-get update -y && apt-get upgrade -y

echo "==> Устанавливаем Docker..."
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable docker
systemctl start docker

echo "==> Создаём рабочую директорию..."
mkdir -p /opt/cargo_bot

echo ""
echo "✅ Сервер готов!"
echo ""
echo "Следующий шаг — добавьте секреты в GitHub (Settings → Secrets → Actions):"
echo ""
echo "  SERVER_HOST        — IP вашего сервера"
echo "  SERVER_USER        — пользователь SSH (обычно root)"
echo "  SERVER_SSH_KEY     — приватный SSH-ключ (содержимое ~/.ssh/id_rsa)"
echo "  BOT_TOKEN          — токен Telegram бота"
echo "  POSTGRES_PASSWORD  — пароль базы данных"
echo "  ADMIN_EMAIL        — email для входа в админ-панель"
echo "  ADMIN_PASSWORD     — пароль для входа в админ-панель"
echo "  ADMIN_COOKIE_SECRET — случайная строка для сессий (минимум 32 символа)"
echo ""
echo "После этого сделайте push в ветку main — деплой запустится автоматически."
