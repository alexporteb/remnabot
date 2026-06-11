import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { startCronJobs } from './cron';
import { getUserByTelegramId, getSubscriptionInfo, deleteAllHwidDevices, getUserHwidDevices, deleteHwidDevice, getSubscriptionSettings, revokeUserSubscription, getAllUsers, extendUserSubscription } from './api';

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

// Admin states
const adminBroadcastState = new Map<number, boolean>();

function isAdmin(telegramId: number): boolean {
    const adminIdsStr = process.env.ADMIN_TELEGRAM_IDS || '';
    const adminIds = adminIdsStr.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    return adminIds.includes(telegramId);
}

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

// --- ADMIN PANEL ---
bot.command('admin', async (ctx) => {
    const telegramId = ctx.from.id;
    if (!isAdmin(telegramId)) return;

    adminBroadcastState.set(telegramId, false); // clear any pending broadcast state

    const text = `👑 **Панель Администратора**\n\nВыберите нужное действие:`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Общий список пользователей', 'admin_users_page:0')],
        [Markup.button.callback('📢 Отправить рассылку всем', 'admin_broadcast_init')]
    ]);

    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('admin_broadcast_init', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    adminBroadcastState.set(telegramId, true);

    const text = `📢 **Ручная рассылка**\n\nОтправьте мне сообщение (текст, картинку или кружок), и я разошлю его всем пользователям бота.\n\nДля отмены нажмите кнопку ниже.`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'admin_broadcast_cancel')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

bot.action('admin_broadcast_cancel', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    adminBroadcastState.set(telegramId, false);
    await ctx.editMessageText("❌ Рассылка отменена.");
    await ctx.answerCbQuery();
});

async function renderAdminUsersPage(ctx: any, page: number) {
    const users = await getAllUsers();
    
    // Calculate daysLeft for sorting and display
    const usersWithDays = users.map(u => {
        let daysLeft = null;
        if (u.expireAt) {
            const diff = new Date(u.expireAt).getTime() - Date.now();
            daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
        }
        return { ...u, daysLeft };
    });

    // Sort users: EXPIRED first, then others, or sort by days left
    usersWithDays.sort((a, b) => {
        if (a.status === 'EXPIRED' && b.status !== 'EXPIRED') return -1;
        if (a.status !== 'EXPIRED' && b.status === 'EXPIRED') return 1;
        return (a.daysLeft || 0) - (b.daysLeft || 0);
    });

    const PAGE_SIZE = 10;
    const totalPages = Math.ceil(usersWithDays.length / PAGE_SIZE) || 1;
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const startIdx = page * PAGE_SIZE;
    const pageUsers = usersWithDays.slice(startIdx, startIdx + PAGE_SIZE);

    let text = `👥 **Список пользователей (Страница ${page + 1}/${totalPages})**\n\n`;
    text += `_Нажмите на кнопку с именем под сообщением, чтобы моментально продлить подписку на 1 месяц._\n\n`;

    const buttons: any[][] = [];

    pageUsers.forEach((u, i) => {
        const isExpired = u.status === 'EXPIRED';
        const statusEmoji = isExpired ? '🔴' : '🟢';
        let expireStr = isExpired ? 'Истекла' : `${u.daysLeft} дн.`;
        if (u.daysLeft === null || u.daysLeft === undefined || u.daysLeft > 3650) expireStr = '∞';

        const safeUsername = escapeMarkdown(u.username);
        text += `${startIdx + i + 1}. ${statusEmoji} **${safeUsername}** - ${expireStr}\n`;
        
        // Button for each user
        buttons.push([Markup.button.callback(`💰 Продлить ${u.username} (+30 дн.)`, `admin_extend:${u.uuid}:${page}`)]);
    });

    // Pagination buttons
    const navRow = [];
    if (page > 0) navRow.push(Markup.button.callback('⬅️ Пред.', `admin_users_page:${page - 1}`));
    if (page < totalPages - 1) navRow.push(Markup.button.callback('След. ➡️', `admin_users_page:${page + 1}`));
    if (navRow.length > 0) buttons.push(navRow);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } else {
        await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
}

bot.action(/admin_users_page:(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const page = parseInt(ctx.match[1], 10);
    try {
        await renderAdminUsersPage(ctx, page);
        await ctx.answerCbQuery();
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка.", { show_alert: true });
    }
});

bot.action(/admin_extend:(.+):(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const targetUuid = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);

    try {
        await extendUserSubscription(targetUuid, 30);
        await ctx.answerCbQuery("✅ Подписка продлена на 30 дней!", { show_alert: true });
        await renderAdminUsersPage(ctx, page);
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при продлении.", { show_alert: true });
    }
});

// Any other messages
bot.on('message', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Check if admin is broadcasting
    if (isAdmin(telegramId) && adminBroadcastState.get(telegramId)) {
        adminBroadcastState.set(telegramId, false); // reset state

        const message = ctx.message;
        const users = await getAllUsers();
        const telegramUsers = users.filter(u => u.telegramId !== null && u.telegramId !== undefined);
        
        await ctx.reply(`⏳ Начинаю рассылку для ${telegramUsers.length} пользователей...`);

        let success = 0;
        let fail = 0;
        for (const u of telegramUsers) {
            if (!u.telegramId) continue;
            try {
                await ctx.telegram.copyMessage(u.telegramId, ctx.chat.id, message.message_id);
                success++;
            } catch (err) {
                fail++;
            }
            // 1 sec delay to avoid rate limit
            await new Promise(r => setTimeout(r, 1000));
        }

        await ctx.reply(`✅ Рассылка завершена!\nУспешно: ${success}\nОшибок: ${fail}`);
        return;
    }

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
