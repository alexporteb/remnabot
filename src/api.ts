import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.REMNAWAVE_API_URL;
const API_KEY = process.env.REMNAWAVE_X_API_KEY;

if (!API_URL || !API_KEY) {
    console.error("Missing REMNAWAVE_API_URL or REMNAWAVE_X_API_KEY in .env");
    process.exit(1);
}

const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
        'X-Api-Key': API_KEY,
        // Also add Authorization just in case it's hitting Remnawave directly without Caddy bypass
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    }
});

export interface User {
    uuid: string;
    shortUuid: string;
    username: string;
    status: 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';
    expireAt: string;
    trafficLimitStrategy: string;
    userTraffic: {
        usedTrafficBytes: number;
        lifetimeUsedTrafficBytes: number;
    };
    trafficLimitBytes: number;
}

export interface SubscriptionInfo {
    isFound: boolean;
    user: {
        shortUuid: string;
        daysLeft: number;
        trafficUsed: string;
        trafficLimit: string;
        lifetimeTrafficUsed: string;
        trafficUsedBytes: string;
        trafficLimitBytes: string;
        username: string;
        expiresAt: string;
        isActive: boolean;
        userStatus: string;
    };
    links: string[];
    subscriptionUrl: string;
}

export async function getUserByTelegramId(telegramId: number): Promise<User | null> {
    try {
        const response = await apiClient.get(`/api/users/by-telegram-id/${telegramId}`);
        const users = response.data?.response;
        if (Array.isArray(users) && users.length > 0) {
            return users[0] as User;
        }
        return null;
    } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
            return null;
        }
        console.error(`Error fetching user by telegram ID ${telegramId}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function getSubscriptionInfo(shortUuid: string): Promise<SubscriptionInfo | null> {
    try {
        const response = await apiClient.get(`/api/sub/${shortUuid}/info`);
        return response.data?.response as SubscriptionInfo;
    } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
            return null;
        }
        console.error(`Error fetching sub info for ${shortUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}
