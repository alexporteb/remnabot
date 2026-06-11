import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { startCronJobs, reloadCronJobs } from './cron';
import { loadConfig, saveConfig } from './config';
import { getUserByTelegramId, getSubscriptionInfo, deleteAllHwidDevices, getUserHwidDevices, deleteHwidDevice, getSubscriptionSettings, revokeUserSubscription, getAllUsers, extendUserSubscription, createUser, changeUserStatus } from './api';

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
const adminDmState = new Map<number, number>(); // adminTelegramId -> targetTelegramId
const adminConfigState = new Map<number, 'DAY' | 'TIME' | 'MSG'>(); // Setting states

interface AddUserState {
    step: 'USERNAME' | 'DURATION' | 'TELEGRAM';
    username?: string;
    days?: number;
}
const adminAddUserState = new Map<number, AddUserState>();

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
    const telegramId = ctx.from?.id;
    const safeUsername = escapeMarkdown(username);
    const message = `👋 Добро пожаловать, **${safeUsername}**!\n\nВыберите нужное действие из меню ниже:`;
    
    const buttons = [
        [Markup.button.callback('📊 Мой профиль', 'action_profile')],
        [Markup.button.callback('🔗 Моя подписка', 'action_subscription')]
    ];

    if (telegramId && isAdmin(telegramId)) {
        buttons.push([Markup.button.callback('👑 Админ-панель', 'action_admin_main')]);
    }

    const keyboard = Markup.inlineKeyboard(buttons);

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
        console.log(`[SUBSCRIPTION_REVOKE] User ${username} (ID: ${telegramId}) successfully recreated their subscription.`);
        
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
        console.log(`[HWID_DELETE] User ${username} (ID: ${telegramId}) successfully deleted device ${hwid}.`);
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
        console.log(`[HWID_RESET] User ${username} (ID: ${telegramId}) successfully reset all devices.`);
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

    if (isAdmin(telegramId)) {
        adminBroadcastState.set(telegramId, false);
        adminDmState.delete(telegramId);
        adminConfigState.delete(telegramId);
        adminAddUserState.delete(telegramId);
    }

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
async function renderAdminMainMenu(ctx: any) {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    adminBroadcastState.set(telegramId, false);
    adminDmState.delete(telegramId);
    adminConfigState.delete(telegramId);
    adminAddUserState.delete(telegramId);

    const text = `👑 **Панель Администратора**\n\nВыберите нужное действие:`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Общий список пользователей', 'admin_users_page:0')],
        [Markup.button.callback('➕ Создать пользователя', 'admin_add_user_init')],
        [Markup.button.callback('📢 Отправить рассылку всем', 'admin_broadcast_init')],
        [Markup.button.callback('⚙️ Настройка авто-оплаты', 'admin_config_menu')],
        [Markup.button.callback('🔙 Выйти к боту', 'action_back')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } else {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
}

bot.command('admin', renderAdminMainMenu);
bot.action('action_admin_main', async (ctx) => {
    await renderAdminMainMenu(ctx);
    await ctx.answerCbQuery();
});

bot.action('admin_broadcast_init', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    adminBroadcastState.set(telegramId, true);

    const text = `📢 **Ручная рассылка**\n\nОтправьте мне сообщение (текст, картинку или кружок), и я разошлю его всем пользователям бота.`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

async function renderAdminUsersPage(ctx: any, page: number) {
    let users = await getAllUsers();
    
    // Filter out users who do not have a telegramId (not using the bot)
    users = users.filter(u => u.telegramId !== null && u.telegramId !== undefined);

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

    let text = `👥 **Список пользователей (Страница ${page + 1}/${totalPages})**\n\n_Выберите пользователя из списка:_`;

    const buttons: any[][] = [];
    let currentRow: any[] = [];

    pageUsers.forEach((u) => {
        const isExpired = u.status === 'EXPIRED';
        const isRed = isExpired || (u.daysLeft !== null && u.daysLeft !== undefined && u.daysLeft < 30);
        const statusEmoji = isRed ? '🔴' : '🟢';
        
        currentRow.push(Markup.button.callback(`${statusEmoji} ${u.username}`, `admin_user_detail:${u.uuid}:${page}`));
        if (currentRow.length === 2) {
            buttons.push(currentRow);
            currentRow = [];
        }
    });

    if (currentRow.length > 0) {
        buttons.push(currentRow);
    }

    // Pagination buttons
    const navRow = [];
    if (page > 0) navRow.push(Markup.button.callback('⬅️ Пред.', `admin_users_page:${page - 1}`));
    if (page < totalPages - 1) navRow.push(Markup.button.callback('След. ➡️', `admin_users_page:${page + 1}`));
    if (navRow.length > 0) buttons.push(navRow);

    // Back to admin menu
    buttons.push([Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]);

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

bot.action(/admin_user_detail:(.+):(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const targetUuid = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);

    try {
        await renderAdminUserDetail(ctx, targetUuid, page);
        await ctx.answerCbQuery();
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка.", { show_alert: true });
    }
});

async function renderAdminUserDetail(ctx: any, targetUuid: string, page: number) {
    let users = await getAllUsers();
    const user = users.find(u => u.uuid === targetUuid);
    
    if (!user) {
        return ctx.answerCbQuery("Пользователь не найден", { show_alert: true });
    }

    let tgUsernameStr = '';
    if (user.telegramId) {
        try {
            const chat = await ctx.telegram.getChat(user.telegramId);
            if ('username' in chat && chat.username) {
                tgUsernameStr = `\n💬 **Telegram:** @${escapeMarkdown(chat.username)}`;
            } else if ('first_name' in chat) {
                tgUsernameStr = `\n💬 **Telegram:** ${escapeMarkdown(chat.first_name)}`;
            }
        } catch (e) {}
    }

    const isExpired = user.status === 'EXPIRED';
    let expireStr = isExpired ? 'Истекла' : 'Активна';
    let isUnlimited = false;
    let daysLeft = 0;
    
    if (user.expireAt) {
        const diff = new Date(user.expireAt).getTime() - Date.now();
        daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
        if (daysLeft > 3650) {
            isUnlimited = true;
            expireStr = '∞ (Безлимит)';
        } else if (!isExpired) {
            expireStr = `${daysLeft} дн.`;
        }
    } else {
        isUnlimited = true;
        expireStr = '∞ (Безлимит)';
    }

    const isRed = isExpired || user.status === 'DISABLED' || (!isUnlimited && daysLeft < 30);
    const statusEmoji = user.status === 'DISABLED' ? '🛑' : (isRed ? '🔴' : '🟢');
    if (user.status === 'DISABLED') expireStr = 'Остановлена';

    const usedTrafficGb = user.userTraffic?.usedTrafficBytes ? (user.userTraffic.usedTrafficBytes / 1073741824).toFixed(2) : '0.00';
    const limitGb = user.trafficLimitBytes ? (user.trafficLimitBytes / 1073741824).toFixed(2) + ' ГБ' : 'Безлимит';
    const lifetimeGb = user.userTraffic?.lifetimeUsedTrafficBytes ? (user.userTraffic.lifetimeUsedTrafficBytes / 1073741824).toFixed(2) : '0.00';

    const text = `👤 **Профиль пользователя:** ${escapeMarkdown(user.username)}\n` +
                 `⏳ **Статус:** ${statusEmoji} ${expireStr}\n` +
                 `📊 **Трафик:** ${usedTrafficGb} ГБ / ${limitGb} (Всего: ${lifetimeGb} ГБ)\n` +
                 `🆔 **Telegram ID:** ${user.telegramId || 'Не привязан'}` + tgUsernameStr;

    const buttons = [];
    
    if (user.status === 'DISABLED') {
        buttons.push([Markup.button.callback('▶️ Возобновить доступ', `a_st:${user.uuid}:A:${page}`)]);
    } else {
        buttons.push([Markup.button.callback('🛑 Приостановить доступ', `a_st:${user.uuid}:D:${page}`)]);
    }

    buttons.push([Markup.button.callback(`⏳ Продлить подписку`, `admin_extend_init:${user.uuid}:${page}`)]);
    
    if (user.telegramId) {
        buttons.push([Markup.button.callback(`✉️ Отправить сообщение`, `admin_dm_init:${user.telegramId}`)]);
    }

    buttons.push([Markup.button.callback('🔙 Назад к списку', `admin_users_page:${page}`)]);

    console.log(`[DEBUG] Rendering detail for user ${targetUuid}. Buttons count: ${buttons.length}`);
    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        console.log(`[DEBUG] editMessageText succeeded`);
    } catch(e) {
        console.error("[DEBUG] Error editing message text:", e);
    }
}

bot.action(/a_st:(.+):([AD]):(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const targetUuid = ctx.match[1];
    const newStatus = ctx.match[2] === 'A' ? 'ACTIVE' : 'DISABLED';
    const page = parseInt(ctx.match[3], 10);

    try {
        await changeUserStatus(targetUuid, newStatus);
        console.log(`[ADMIN] Telegram ID ${telegramId} changed status for user UUID ${targetUuid} to ${newStatus}.`);
        await renderAdminUserDetail(ctx, targetUuid, page);
        await ctx.answerCbQuery(newStatus === 'ACTIVE' ? "✅ Доступ возобновлен" : "🛑 Доступ приостановлен", { show_alert: true });
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка.", { show_alert: true });
    }
});

bot.action(/admin_extend_init:(.+):(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const targetUuid = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);

    const text = `⏳ **Продление подписки**\n\nВыберите, на какой срок вы хотите продлить подписку пользователя:`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('1 месяц', `admin_extend:${targetUuid}:30:${page}`), Markup.button.callback('3 месяца', `admin_extend:${targetUuid}:90:${page}`)],
        [Markup.button.callback('На год', `admin_extend:${targetUuid}:365:${page}`), Markup.button.callback('Безлимит', `admin_extend:${targetUuid}:36500:${page}`)],
        [Markup.button.callback('🔙 Назад к профилю', `admin_user_detail:${targetUuid}:${page}`)]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

bot.action(/admin_extend:(.+):(\d+):(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const targetUuid = ctx.match[1];
    const days = parseInt(ctx.match[2], 10);
    const page = parseInt(ctx.match[3], 10);

    try {
        await extendUserSubscription(targetUuid, days);
        console.log(`[ADMIN] Telegram ID ${telegramId} extended subscription for user UUID ${targetUuid} by ${days} days.`);
        await renderAdminUserDetail(ctx, targetUuid, page);
        await ctx.answerCbQuery(`✅ Подписка продлена на ${days} дней!`, { show_alert: true });
    } catch (e) {
        console.error(e);
        await ctx.answerCbQuery("Ошибка при продлении.", { show_alert: true });
    }
});

bot.action(/admin_dm_init:(.+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const targetTelegramId = parseInt(ctx.match[1], 10);
    adminDmState.set(telegramId, targetTelegramId);
    adminBroadcastState.set(telegramId, false);
    adminConfigState.delete(telegramId);
    adminAddUserState.delete(telegramId);

    let targetName = 'Неизвестный';
    try {
        const targetUser = await getUserByTelegramId(targetTelegramId);
        if (targetUser) targetName = escapeMarkdown(targetUser.username);
    } catch(e) {}

    const text = `✉️ **Вы пишете сообщение пользователю:** **${targetName}**\n\nОтправьте мне сообщение (текст, картинку или кружок), и я перешлю его.`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

bot.action('admin_add_user_init', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    adminAddUserState.set(telegramId, { step: 'USERNAME' });
    adminBroadcastState.set(telegramId, false);
    adminConfigState.delete(telegramId);
    adminDmState.delete(telegramId);

    const text = `➕ **Добавление нового пользователя (Шаг 1 из 3)**\n\n` +
                 `Отправьте логин нового пользователя.\n\n` +
                 `_Разрешены только английские буквы, цифры, дефисы и подчеркивания (от 3 до 36 символов)._`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

bot.action(/admin_add_user_duration:(\d+)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const addUserState = adminAddUserState.get(telegramId);
    if (!addUserState || addUserState.step !== 'DURATION') return;

    addUserState.days = parseInt(ctx.match[1], 10);
    addUserState.step = 'TELEGRAM';

    const text = `⏳ **Шаг 3 из 3**\nСрок подписки выбран: **${addUserState.days} дней**.\n\nХотите привязать пользователя к Telegram?\nОтправьте его Telegram ID сообщением (или перешлите сообщение от него), либо нажмите кнопку "Пропустить".`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⏭ Пропустить привязку', 'admin_add_user_skip_tg')],
        [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

async function finalizeCreateUser(ctx: any, adminTelegramId: number, state: AddUserState, targetTelegramId?: number) {
    try {
        let msg = await ctx.reply(`⏳ Создаю пользователя ${escapeMarkdown(state.username!)}...`);
        await createUser(state.username!, state.days!, targetTelegramId);
        console.log(`[ADMIN_CREATE_USER] Telegram ID ${adminTelegramId} successfully created user ${state.username} for ${state.days} days.`);
        adminAddUserState.delete(adminTelegramId);

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('👥 Перейти к списку пользователей', 'admin_users_page:0')],
            [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
        ]);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ Пользователь **${escapeMarkdown(state.username!)}** успешно создан!\nВыдана подписка на ${state.days} дней.`, { parse_mode: 'Markdown', ...keyboard });
    } catch (err: any) {
        await ctx.reply(`❌ Ошибка при создании пользователя. Возможно, логин уже занят или произошел сбой.`);
        adminAddUserState.delete(adminTelegramId);
    }
}

bot.action('admin_add_user_skip_tg', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const addUserState = adminAddUserState.get(telegramId);
    if (!addUserState || addUserState.step !== 'TELEGRAM') return;

    await finalizeCreateUser(ctx, telegramId, addUserState, undefined);
    await ctx.answerCbQuery();
});

// --- CONFIG MENU ---
bot.action('admin_config_menu', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    adminConfigState.delete(telegramId);
    const config = loadConfig();

    const text = `⚙️ **Настройка авто-напоминаний об оплате**\n\n` +
                 `Текущие настройки:\n` +
                 `📅 **День месяца:** ${config.paymentNotificationDay || 'Отключено (0)'}\n` +
                 `⏰ **Время:** ${config.paymentNotificationTime} (По Москве)\n` +
                 `📝 **Текст:**\n\`${config.paymentNotificationMessage}\``;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📅 Изменить день', 'admin_config_day'), Markup.button.callback('⏰ Изменить время', 'admin_config_time')],
        [Markup.button.callback('📝 Изменить текст', 'admin_config_msg')],
        [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
});

bot.action(/admin_config_(day|time|msg)/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !isAdmin(telegramId)) return;

    const type = ctx.match[1].toUpperCase() as 'DAY' | 'TIME' | 'MSG';
    adminConfigState.set(telegramId, type);

    let text = '';
    if (type === 'DAY') text = `Введите день месяца для рассылки (от 1 до 31). Введите 0, чтобы отключить рассылку.`;
    else if (type === 'TIME') text = `Введите время по Москве в формате ЧЧ:ММ (например, 10:00 или 18:30).`;
    else if (type === 'MSG') text = `Введите новый текст сообщения для рассылки.`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад к настройкам', 'admin_config_menu')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    await ctx.answerCbQuery();
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

        console.log(`[ADMIN_BROADCAST] Telegram ID ${telegramId} sent broadcast. Success: ${success}, Fail: ${fail}`);
        await ctx.reply(`✅ Рассылка завершена!\nУспешно: ${success}\nОшибок: ${fail}`);
        return;
    }

    // Check if admin is sending DM
    const targetTelegramId = adminDmState.get(telegramId);
    if (isAdmin(telegramId) && targetTelegramId) {
        adminDmState.delete(telegramId); // reset state

        const message = ctx.message;
        try {
            await ctx.telegram.copyMessage(targetTelegramId, ctx.chat.id, message.message_id);
            console.log(`[ADMIN_DM] Telegram ID ${telegramId} sent DM to Telegram ID ${targetTelegramId}.`);
            await ctx.reply(`✅ Сообщение успешно отправлено пользователю!`);
        } catch (err) {
            await ctx.reply(`❌ Ошибка отправки сообщения. Возможно, пользователь заблокировал бота.`);
        }
        return;
    }

    // Check if admin is configuring auto-notifications
    const configState = adminConfigState.get(telegramId);
    if (isAdmin(telegramId) && configState) {
        const text = 'text' in ctx.message ? ctx.message.text : '';
        if (!text) {
            await ctx.reply("Пожалуйста, отправьте текст.");
            return;
        }

        const config = loadConfig();
        if (configState === 'DAY') {
            const day = parseInt(text, 10);
            if (isNaN(day) || day < 0 || day > 31) {
                await ctx.reply("❌ Неверный формат. Введите число от 0 до 31.");
                return;
            }
            config.paymentNotificationDay = day;
        } else if (configState === 'TIME') {
            const parts = text.split(':');
            if (parts.length !== 2 || isNaN(parseInt(parts[0], 10)) || isNaN(parseInt(parts[1], 10))) {
                await ctx.reply("❌ Неверный формат. Введите время в формате ЧЧ:ММ (например, 10:00).");
                return;
            }
            config.paymentNotificationTime = text;
        } else if (configState === 'MSG') {
            config.paymentNotificationMessage = text;
        }

        saveConfig(config);
        console.log(`[ADMIN] Telegram ID ${telegramId} updated config: Day ${config.paymentNotificationDay}, Time ${config.paymentNotificationTime}, Msg "${config.paymentNotificationMessage.substring(0, 20)}..."`);
        reloadCronJobs(bot);
        adminConfigState.delete(telegramId);

        const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🔙 Вернуться к настройкам', 'admin_config_menu')]]);
        await ctx.reply("✅ Настройки успешно сохранены и авто-рассылка перезапущена!", { ...keyboard });
        return;
    }

    // Check if admin is adding a new user
    const addUserState = adminAddUserState.get(telegramId);
    if (isAdmin(telegramId) && addUserState) {
        if (addUserState.step === 'USERNAME') {
            const username = 'text' in ctx.message ? ctx.message.text.trim() : '';
            if (!/^[a-zA-Z0-9_-]{3,36}$/.test(username)) {
                await ctx.reply("❌ Недопустимое имя пользователя. Разрешены только английские буквы, цифры, дефисы и подчеркивания (от 3 до 36 символов).");
                return;
            }
            addUserState.username = username;
            addUserState.step = 'DURATION';
            
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('1 месяц', 'admin_add_user_duration:30'), Markup.button.callback('3 месяца', 'admin_add_user_duration:90')],
                [Markup.button.callback('На год', 'admin_add_user_duration:365'), Markup.button.callback('Безлимит', 'admin_add_user_duration:36500')],
                [Markup.button.callback('🔙 Назад в админ-меню', 'action_admin_main')]
            ]);
            await ctx.reply(`👤 Логин **${escapeMarkdown(username)}** принят.\n\n**Шаг 2 из 3:** На какой срок создать подписку?`, { parse_mode: 'Markdown', ...keyboard });
            return;
        } else if (addUserState.step === 'TELEGRAM') {
            let targetTelegramId: number | undefined = undefined;

            const msgAny = ctx.message as any;
            // Check if it's a forwarded message
            if (msgAny.forward_from && msgAny.forward_from.id) {
                targetTelegramId = msgAny.forward_from.id;
            } else if (msgAny.forward_origin && msgAny.forward_origin.type === 'user') {
                targetTelegramId = msgAny.forward_origin.sender_user?.id;
            } else {
                const text = 'text' in ctx.message ? ctx.message.text.trim() : '';
                targetTelegramId = parseInt(text, 10);
            }

            if (!targetTelegramId || isNaN(targetTelegramId)) {
                await ctx.reply("❌ Не удалось определить Telegram ID. Пожалуйста, перешлите сообщение от пользователя, отправьте только число (его ID), либо нажмите кнопку 'Пропустить привязку'.",
                    Markup.inlineKeyboard([[Markup.button.callback('⏭ Пропустить привязку', 'admin_add_user_skip_tg')]])
                );
                return;
            }

            await finalizeCreateUser(ctx, telegramId, addUserState, targetTelegramId);
            return;
        }
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
