import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { getUserByTelegramId, getSubscriptionInfo, deleteAllHwidDevices, getUserHwidDevices, deleteHwidDevice } from './api';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("Missing BOT_TOKEN in .env");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Generic error for unauthorized users
const unauthorizedMessage = "Команда не распознана.";

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.reply(unauthorizedMessage);
        }

        await sendMainMenu(ctx, user.username);
    } catch (e) {
        console.error(e);
        return ctx.reply("Произошла ошибка при обработке запроса.");
    }
});

async function sendMainMenu(ctx: any, username: string) {
    const message = `👋 Добро пожаловать, **${username}**!\n\nВыберите нужное действие из меню ниже:`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Мой профиль', 'action_profile')],
        [Markup.button.callback('🔗 Моя подписка', 'action_subscription')],
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard });
    } else {
        await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
    }
}

bot.action('action_profile', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }

        const subInfo = await getSubscriptionInfo(user.shortUuid);
        if (!subInfo || !subInfo.isFound) {
            return ctx.answerCbQuery("Информация о подписке не найдена.", { show_alert: true });
        }

        const s = subInfo.user;
        const statusMap: Record<string, string> = {
            'ACTIVE': '🟢 Активен',
            'DISABLED': '🔴 Отключен',
            'LIMITED': '🟡 Ограничен',
            'EXPIRED': '⚫ Истек'
        };

        const status = statusMap[s.userStatus] || s.userStatus;
        
        let expireText = 'Истекла';
        if (s.daysLeft > 3650) {
            expireText = 'Бесконечно';
        } else if (s.daysLeft > 0) {
            expireText = `${s.daysLeft} дн.`;
        } else if (s.daysLeft === null || s.daysLeft === undefined) {
            expireText = 'Бесконечно';
        }

        const isUnlimitedTraffic = s.trafficLimit === '0 B' || s.trafficLimit === '0' || s.trafficLimitBytes === '0' || Number(s.trafficLimitBytes) === 0;
        const trafficLimitText = isUnlimitedTraffic ? 'Бесконечно' : s.trafficLimit;

        const text = `📊 **Ваш профиль**\n\n` +
            `👤 **Имя пользователя:** ${s.username}\n` +
            `🚦 **Статус:** ${status}\n` +
            `⏳ **Осталось времени:** ${expireText}\n` +
            `📈 **Использовано трафика:** ${s.trafficUsed} из ${trafficLimitText}\n` +
            `🌐 **Всего использовано:** ${s.lifetimeTrafficUsed}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Назад', 'action_back')]
        ]);

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        await ctx.answerCbQuery();
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при получении профиля.", { show_alert: true });
    }
});

bot.action('action_subscription', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }

        const subInfo = await getSubscriptionInfo(user.shortUuid);
        if (!subInfo || !subInfo.isFound) {
            return ctx.answerCbQuery("Информация о подписке не найдена.", { show_alert: true });
        }

        let text = `🔗 **Ваша подписка**\n\n`;
        text += `**Ссылка на автонастройку:**\n\`${subInfo.subscriptionUrl}\`\n\n`;
        text += `_Скопируйте эту ссылку и вставьте в ваше приложение (например, v2rayNG или NekoBox)._`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('📱 Управление устройствами (HWID)', 'action_hwid_menu')],
            [Markup.button.callback('⬅️ Назад', 'action_back')]
        ]);

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        await ctx.answerCbQuery();
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при получении подписки.", { show_alert: true });
    }
});

bot.action('action_hwid_menu', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }

        const devices = await getUserHwidDevices(user.uuid);
        const limitStr = user.hwidDeviceLimit ? user.hwidDeviceLimit.toString() : '∞';
        
        let text = `📱 **Ваши устройства (HWID)**\n\n`;
        text += `Подключено: **${devices.length} / ${limitStr}**\n\n`;

        const buttons: any[][] = [];

        if (devices.length === 0) {
            text += `_У вас нет подключенных устройств._`;
        } else {
            devices.forEach((d, i) => {
                const name = d.deviceModel || d.osVersion || d.platform || 'Неизвестное устройство';
                text += `${i + 1}. **${name}**\n   └ Добавлено: ${new Date(d.createdAt).toLocaleDateString('ru-RU')}\n`;
                // Add a button to delete this specific device
                // Limit is 64 bytes. "del_hwid:" + 36 = 45 bytes.
                buttons.push([Markup.button.callback(`❌ Удалить устройство ${i + 1}`, `del_hwid:${d.hwid}`)]);
            });
            
            buttons.push([Markup.button.callback('🗑️ Сбросить все устройства', 'action_reset_hwid')]);
        }

        buttons.push([Markup.button.callback('⬅️ Назад к подписке', 'action_subscription')]);

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        await ctx.answerCbQuery();
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при получении списка устройств.", { show_alert: true });
    }
});

bot.action(/del_hwid:(.+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const hwid = ctx.match[1];

    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });

        await deleteHwidDevice(user.uuid, hwid);
        await ctx.answerCbQuery("✅ Устройство успешно удалено!", { show_alert: true });
        
        // Refresh HWID menu by simulating clicking the HWID menu button again
        const devices = await getUserHwidDevices(user.uuid);
        const limitStr = user.hwidDeviceLimit ? user.hwidDeviceLimit.toString() : '∞';
        let text = `📱 **Ваши устройства (HWID)**\n\nПодключено: **${devices.length} / ${limitStr}**\n\n`;
        const buttons: any[][] = [];
        if (devices.length === 0) {
            text += `_У вас нет подключенных устройств._`;
        } else {
            devices.forEach((d, i) => {
                const name = d.deviceModel || d.osVersion || d.platform || 'Неизвестное устройство';
                text += `${i + 1}. **${name}**\n   └ Добавлено: ${new Date(d.createdAt).toLocaleDateString('ru-RU')}\n`;
                buttons.push([Markup.button.callback(`❌ Удалить устройство ${i + 1}`, `del_hwid:${d.hwid}`)]);
            });
            buttons.push([Markup.button.callback('🗑️ Сбросить все устройства', 'action_reset_hwid')]);
        }
        buttons.push([Markup.button.callback('⬅️ Назад к подписке', 'action_subscription')]);
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при удалении устройства.", { show_alert: true });
    }
});

bot.action('action_reset_hwid', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }

        await deleteAllHwidDevices(user.uuid);
        await ctx.answerCbQuery("✅ Ваши устройства успешно сброшены!", { show_alert: true });
        
        // Return to subscription menu
        const subInfo = await getSubscriptionInfo(user.shortUuid);
        if (!subInfo || !subInfo.isFound) {
            return ctx.answerCbQuery("Информация о подписке не найдена.", { show_alert: true });
        }

        let text = `🔗 **Ваша подписка**\n\n`;
        text += `**Ссылка на автонастройку:**\n\`${subInfo.subscriptionUrl}\`\n\n`;
        text += `_Скопируйте эту ссылку и вставьте в ваше приложение (например, v2rayNG или NekoBox)._`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('📱 Управление устройствами (HWID)', 'action_hwid_menu')],
            [Markup.button.callback('⬅️ Назад', 'action_back')]
        ]);

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при сбросе устройств.", { show_alert: true });
    }
});

bot.action('action_back', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }
        await sendMainMenu(ctx, user.username);
        await ctx.answerCbQuery();
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка.", { show_alert: true });
    }
});

// Any other messages
bot.on('message', (ctx) => {
    ctx.reply(unauthorizedMessage);
});

bot.launch().then(() => {
    console.log("Bot started successfully!");
}).catch((err) => {
    console.error("Failed to start bot:", err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
