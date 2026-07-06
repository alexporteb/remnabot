import fs from 'fs';
import path from 'path';

const activeUsersPath = path.join(process.cwd(), 'data', 'active_users.json');

let activeUsersSet = new Set<number>();

export function loadActiveUsers(): void {
    try {
        if (fs.existsSync(activeUsersPath)) {
            const data = fs.readFileSync(activeUsersPath, 'utf8');
            const arr = JSON.parse(data);
            if (Array.isArray(arr)) {
                activeUsersSet = new Set(arr.map(id => Number(id)).filter(id => !isNaN(id)));
            }
        }
    } catch (e) {
        console.error("Error reading active_users.json", e);
    }
}

export function saveActiveUser(telegramId: number): void {
    if (activeUsersSet.has(telegramId)) return;
    
    activeUsersSet.add(telegramId);
    try {
        const dir = path.dirname(activeUsersPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(activeUsersPath, JSON.stringify(Array.from(activeUsersSet)), 'utf8');
    } catch (e) {
        console.error("Error saving active_users.json", e);
    }
}

export function isUserActive(telegramId: number | null | undefined): boolean {
    if (!telegramId) return false;
    return activeUsersSet.has(telegramId);
}
