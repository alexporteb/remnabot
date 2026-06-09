import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { startCronJobs } from './cron';
import { getUserByTelegramId, getSubscriptionInfo, deleteAllHwidDevices, getUserHwidDevices, deleteHwidDevice, getSubscriptionSettings, revokeUserSubscription } from './api';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("Missing BOT_TOKEN in .env");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function escapeMarkdown(text: string): string {
    if (!text) return '';
    return text.replace(/[_*[\]`]/g, '\\$&');
}

// Generic error for unauthorized users
const unauthorizedMessage = "Команда не распознана.";

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Unknown';
    console.log(`[START] User ${username} (ID: ${telegramId}) started the bot.`);
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
    const safeUsername = escapeMarkdown(username);
    const message = `👋 Добро пожаловать, **${safeUsername}**!\n\nВыберите нужное действие из меню ниже:`;
    
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
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
    if (!telegramId) return;

    console.log(`[PROFILE] User ${username} (ID: ${telegramId}) requested profile.`);
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
            expireText = '∞';
        } else if (s.daysLeft > 0) {
            expireText = `${s.daysLeft} дн.`;
        } else if (s.daysLeft === null || s.daysLeft === undefined) {
            expireText = '∞';
        }

        const isUnlimitedTraffic = s.trafficLimit === '0 B' || s.trafficLimit === '0' || s.trafficLimitBytes === '0' || Number(s.trafficLimitBytes) === 0;
        const trafficLimitText = isUnlimitedTraffic ? '∞' : s.trafficLimit;

        const safeUsername = escapeMarkdown(s.username);
        const text = `📊 **Ваш профиль**\n\n` +
            `👤 **Имя пользователя:** ${safeUsername}\n` +
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
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
    if (!telegramId) return;

    console.log(`[SUBSCRIPTION] User ${username} (ID: ${telegramId}) requested subscription info.`);
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
        text += `_Скопируйте эту ссылку и вставьте в ваше приложение._`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('🌐 Открыть в браузере', subInfo.subscriptionUrl)],
            [Markup.button.callback('🔄 Пересоздать ссылку', 'action_revoke_sub')],
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

bot.action('action_revoke_sub', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    let text = `⚠️ **Внимание!**\n\nВы уверены, что хотите пересоздать ссылку на подписку?\n\nВаша текущая ссылка перестанет работать, и вам придется заново добавить новую ссылку во все ваши приложения.`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, пересоздать', 'action_revoke_sub_execute')],
        [Markup.button.callback('❌ Отмена', 'action_subscription')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

bot.action('action_revoke_sub_execute', async (ctx) => {
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
    if (!telegramId) return;

    console.log(`[SUBSCRIPTION_REVOKE] User ${username} (ID: ${telegramId}) confirming subscription recreation.`);
    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }

        await revokeUserSubscription(user.uuid);
        
        // Wait 2.5 seconds for Remnawave backend to regenerate the subscription
        await new Promise(resolve => setTimeout(resolve, 2500));

        // Fetch new user object to get the new shortUuid
        const updatedUser = await getUserByTelegramId(telegramId);
        if (!updatedUser) {
            return ctx.answerCbQuery("Ошибка получения обновленного профиля.", { show_alert: true });
        }
        
        // Fetch new subscription info
        const subInfo = await getSubscriptionInfo(updatedUser.shortUuid);
        if (!subInfo || !subInfo.isFound) {
            return ctx.answerCbQuery("Подписка пересоздана, но информация не найдена.", { show_alert: true });
        }

        let text = `🔗 **Ваша подписка**\n\n`;
        text += `✅ **Ссылка успешно обновлена!**\n\n`;
        text += `**Ссылка на автонастройку:**\n\`${subInfo.subscriptionUrl}\`\n\n`;
        text += `_Скопируйте эту ссылку и вставьте в ваше приложение._`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url('🌐 Открыть в браузере', subInfo.subscriptionUrl)],
            [Markup.button.callback('🔄 Пересоздать ссылку', 'action_revoke_sub')],
            [Markup.button.callback('📱 Управление устройствами (HWID)', 'action_hwid_menu')],
            [Markup.button.callback('⬅️ Назад', 'action_back')]
        ]);

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        await ctx.answerCbQuery("✅ Ссылка успешно пересоздана!", { show_alert: false });
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при пересоздании подписки.", { show_alert: true });
    }
});

bot.action('action_hwid_menu', async (ctx) => {
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
    if (!telegramId) return;

    console.log(`[HWID_MENU] User ${username} (ID: ${telegramId}) opened HWID menu.`);
    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) {
            return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });
        }

        const devices = await getUserHwidDevices(user.uuid);
        let limitStr = '∞';
        if (user.hwidDeviceLimit !== null) {
            limitStr = user.hwidDeviceLimit.toString();
        } else {
            const settings = await getSubscriptionSettings();
            if (settings?.hwidSettings?.enabled && settings.hwidSettings.fallbackDeviceLimit > 0) {
                limitStr = settings.hwidSettings.fallbackDeviceLimit.toString();
            }
        }
        
        let text = `📱 **Ваши устройства (HWID)**\n\n`;
        text += `Подключено: **${devices.length} / ${limitStr}**\n\n`;

        const buttons: any[][] = [];

        if (devices.length === 0) {
            text += `_У вас нет подключенных устройств._`;
        } else {
            devices.forEach((d, i) => {
                const name = escapeMarkdown(d.deviceModel || d.osVersion || d.platform || 'Неизвестное устройство');
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
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
    if (!telegramId) return;
    const hwid = ctx.match[1];

    console.log(`[HWID_DELETE] User ${username} (ID: ${telegramId}) attempting to delete device ${hwid}.`);
    try {
        const user = await getUserByTelegramId(telegramId);
        if (!user) return ctx.answerCbQuery(unauthorizedMessage, { show_alert: true });

        await deleteHwidDevice(user.uuid, hwid);
        await ctx.answerCbQuery("✅ Устройство успешно удалено!", { show_alert: true });
        
        // Refresh HWID menu by simulating clicking the HWID menu button again
        const devices = await getUserHwidDevices(user.uuid);
        let limitStr = '∞';
        if (user.hwidDeviceLimit !== null) {
            limitStr = user.hwidDeviceLimit.toString();
        } else {
            const settings = await getSubscriptionSettings();
            if (settings?.hwidSettings?.enabled && settings.hwidSettings.fallbackDeviceLimit > 0) {
                limitStr = settings.hwidSettings.fallbackDeviceLimit.toString();
            }
        }
        let text = `📱 **Ваши устройства (HWID)**\n\nПодключено: **${devices.length} / ${limitStr}**\n\n`;
        const buttons: any[][] = [];
        if (devices.length === 0) {
            text += `_У вас нет подключенных устройств._`;
        } else {
            devices.forEach((d, i) => {
                const name = escapeMarkdown(d.deviceModel || d.osVersion || d.platform || 'Неизвестное устройство');
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
    const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
    if (!telegramId) return;

    console.log(`[HWID_RESET] User ${username} (ID: ${telegramId}) requested to reset all devices.`);
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
        text += `_Скопируйте эту ссылку и вставьте в ваше приложение._`;

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
    const telegramId = ctx.from?.id;
    const text = 'text' in ctx.message ? ctx.message.text : 'non-text message';
    console.log(`[MESSAGE] Unhandled message from ID ${telegramId}: ${text}`);
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

// Start cron jobs
startCronJobs(bot);
