import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { getAllUsers } from './api';
import { loadConfig } from './config';

let currentTask: any = null;

export function startCronJobs(bot: Telegraf) {
    reloadCronJobs(bot);
}

export function reloadCronJobs(bot: Telegraf) {
    if (currentTask) {
        currentTask.stop();
        currentTask = null;
    }

    const config = loadConfig();
    const dayStr = config.paymentNotificationDay;
    const day = typeof dayStr === 'string' ? parseInt(dayStr, 10) : dayStr;
    const timeStr = config.paymentNotificationTime;
    const msg = config.paymentNotificationMessage;

    if (isNaN(day) || day <= 0 || day > 31 || !timeStr) {
        console.log("[CRON] Payment notifications are disabled or misconfigured.");
        return;
    }

    const parts = timeStr.split(':');
    if (parts.length !== 2) {
        console.log("[CRON] Invalid time format for PAYMENT_NOTIFICATION_TIME. Use HH:MM");
        return;
    }

    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);

    if (isNaN(hour) || isNaN(minute)) {
        console.log("[CRON] Invalid time format.");
        return;
    }

    const cronExpression = `${minute} ${hour} ${day} * *`;
    console.log(`[CRON] Scheduled payment notifications for day ${day} at ${timeStr} MSK.`);

    currentTask = cron.schedule(cronExpression, async () => {
        console.log("[CRON] Executing payment notifications...");
        try {
            const users = await getAllUsers();
            let successCount = 0;
            let failCount = 0;
            
            for (const user of users) {
                if (user.telegramId) {
                    try {
                        await bot.telegram.sendMessage(user.telegramId, msg);
                        successCount++;
                    } catch (e) {
                        console.error(`[CRON] Failed to send to ${user.telegramId}:`, e);
                        failCount++;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            console.log(`[CRON] Payment notification job finished. Success: ${successCount}, Failed: ${failCount}.`);
        } catch (error: any) {
            console.error('[CRON] Critical error during payment notification job:', error.message);
        }
    }, {
        timezone: 'Europe/Moscow'
    });
}
