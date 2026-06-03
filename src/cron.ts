import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { getAllUsers } from './api';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function startCronJobs(bot: Telegraf) {
    const paymentDayStr = process.env.PAYMENT_NOTIFICATION_DAY || '0';
    const paymentTimeStr = process.env.PAYMENT_NOTIFICATION_TIME || '10:00';
    const paymentMessage = process.env.PAYMENT_NOTIFICATION_MESSAGE || 'Пожалуйста, оплатите подписку на VPN, иначе доступ будет приостановлен.';
    
    const paymentDay = parseInt(paymentDayStr, 10);
    
    // Only schedule if payment notification is enabled (day > 0 and <= 31)
    if (isNaN(paymentDay) || paymentDay <= 0 || paymentDay > 31) {
        console.log('[CRON] Payment notification is disabled (PAYMENT_NOTIFICATION_DAY is 0 or invalid).');
        return;
    }

    const timeParts = paymentTimeStr.split(':');
    const hour = timeParts[0] ? parseInt(timeParts[0], 10) : 10;
    const minute = timeParts[1] ? parseInt(timeParts[1], 10) : 0;

    // Cron expression: minute hour day-of-month * *
    const cronExpression = `${minute} ${hour} ${paymentDay} * *`;

    console.log(`[CRON] Scheduled payment notifications for day ${paymentDay} at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}.`);

    cron.schedule(cronExpression, async () => {
        console.log('[CRON] Executing payment notification job...');
        
        try {
            const users = await getAllUsers();
            console.log(`[CRON] Fetched ${users.length} users from Remnawave.`);
            
            // Filter users who have a telegramId
            const telegramUsers = users.filter(u => u.telegramId !== null && u.telegramId !== undefined);
            console.log(`[CRON] Found ${telegramUsers.length} users with linked Telegram IDs.`);
            
            let successCount = 0;
            let failCount = 0;

            for (const user of telegramUsers) {
                if (user.telegramId) {
                    try {
                        await bot.telegram.sendMessage(user.telegramId, paymentMessage);
                        successCount++;
                        console.log(`[CRON] Sent payment notification to user ${user.username} (ID: ${user.telegramId})`);
                    } catch (err: any) {
                        failCount++;
                        console.error(`[CRON] Failed to send notification to user ${user.username} (ID: ${user.telegramId}):`, err.message);
                    }
                    // Wait 1 second before sending the next message to prevent Telegram rate limiting (max 30 msgs/sec)
                    await delay(1000);
                }
            }
            console.log(`[CRON] Payment notification job finished. Success: ${successCount}, Failed: ${failCount}.`);
        } catch (error: any) {
            console.error('[CRON] Critical error during payment notification job:', error.message);
        }
    });
}
