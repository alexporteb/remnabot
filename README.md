# Remnabot - Telegram Bot for Remnawave VLESS

Этот бот предназначен для пользователей панели Remnawave (VLESS). Он позволяет пользователям получать информацию о своем профиле (остаток трафика, статус, дату истечения) и ссылки на подписку прямо через Telegram.

## Требования

* Docker и Docker Compose на вашем сервере (VPS).
* Панель Remnawave (бот работает через Caddy Auth Portal или напрямую, если настроено).

## Запуск на VPS

Вам не нужно собирать образ на вашем сервере. Он автоматически собирается через GitHub Actions и доступен в GitHub Container Registry (ghcr.io).

### 1. Скачайте `docker-compose.yml` и `.env.example` на ваш сервер:

```bash
mkdir remnabot && cd remnabot
wget https://raw.githubusercontent.com/alexporteb/remnabot/main/docker-compose.yml
wget https://raw.githubusercontent.com/alexporteb/remnabot/main/.env.example -O .env
```

### 2. Настройте файл `.env`:

Откройте файл `.env` и заполните ваши данные:

```env
# Ваш токен Telegram бота от BotFather
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ

# Базовый URL вашей панели Remnawave (с https://)
REMNAWAVE_API_URL=https://panel.yourdomain.com

# X-Api-Key, сгенерированный в портале авторизации Caddy (или API токен Remnawave)
REMNAWAVE_X_API_KEY=YxOovHLnpkcmSig508...
```

### 3. Запустите бота:

```bash
docker-compose up -d
```

### 4. Просмотр логов:

```bash
docker-compose logs -f
```
