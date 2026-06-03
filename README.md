# Remnabot - Telegram Bot for Remnawave

Этот бот предназначен для пользователей панели Remnawave (VLESS). Он позволяет пользователям получать информацию о своем профиле (остаток трафика, статус, дату истечения) и ссылки на подписку прямо через Telegram.

## Требования

* Установленный Docker на вашем сервере (VPS).
* Панель Remnawave (бот работает через Caddy Auth Portal или напрямую, если настроено).

## Запуск на VPS

Вам не нужно собирать образ на вашем сервере. Он автоматически собирается через GitHub Actions и доступен в GitHub Container Registry (ghcr.io).

### 1. Скачайте файлы запуска на ваш сервер:

Создайте папку для бота (например, рядом с вашей панелью) и скачайте нужные файлы:
```bash
mkdir -p /opt/remnawave/remnabot && cd /opt/remnawave/remnabot
wget https://raw.githubusercontent.com/alexporteb/remnabot/main/docker-compose.yml
wget https://raw.githubusercontent.com/alexporteb/remnabot/main/.env.example -O .env
```

### 2. Настройте файл `.env`:

Откройте файл `.env`:
```bash
nano .env
```
Заполните ваши данные (для работы по внутренней сети используйте адрес `http://remnawave:3000`):

```env
# Ваш токен Telegram бота от BotFather
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ

# Внутренний адрес панели в сети Docker (рекомендуется)
REMNAWAVE_API_URL=http://remnawave:3000

# X-Api-Key, сгенерированный в самой панели Remnawave (Admin -> System -> API Tokens)
REMNAWAVE_X_API_KEY=eyJhbGciOi...

# --- НАСТРОЙКИ УВЕДОМЛЕНИЙ ОБ ОПЛАТЕ (Опционально) ---
# День месяца для рассылки (от 1 до 31). Установите 0, чтобы отключить.
PAYMENT_NOTIFICATION_DAY=0
# Время рассылки по серверному времени
PAYMENT_NOTIFICATION_TIME=10:00
# Текст сообщения
PAYMENT_NOTIFICATION_MESSAGE=Напоминаем об оплате подписки!
```

### 3. Запустите бота:

Запустите контейнер командой (обратите внимание на пробел между docker и compose):
```bash
docker compose pull
docker compose up -d
```

### 4. Просмотр логов:

```bash
docker compose logs -f
```

## Полное удаление бота

Если вы хотите полностью удалить бота со всеми его файлами и контейнерами, выполните эту команду одной строкой:
```bash
cd /opt/remnawave/remnabot && docker compose down && cd .. && rm -rf remnabot && docker rmi ghcr.io/alexporteb/remnabot:main
```
