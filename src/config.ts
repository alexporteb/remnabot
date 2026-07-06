import fs from 'fs';
import path from 'path';

export interface BotConfig {
    paymentNotificationDay: number;
    paymentNotificationTime: string;
    paymentNotificationMessage: string;
}

const configPath = path.join(process.cwd(), 'data', 'config.json');

export function loadConfig(): BotConfig {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading config.json, falling back to .env", e);
    }

    // Fallback to .env
    const dayStr = process.env.PAYMENT_NOTIFICATION_DAY || '0';
    const day = parseInt(dayStr, 10);
    return {
        paymentNotificationDay: isNaN(day) ? 0 : day,
        paymentNotificationTime: process.env.PAYMENT_NOTIFICATION_TIME || '10:00',
        paymentNotificationMessage: process.env.PAYMENT_NOTIFICATION_MESSAGE || 'Пожалуйста, оплатите подписку на VPN, иначе доступ будет приостановлен.'
    };
}

export function saveConfig(config: BotConfig): void {
    try {
        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving config.json", e);
    }
}
