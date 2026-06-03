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
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        // Remnawave's ProxyCheckMiddleware requires these headers to accept direct local connections
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': '127.0.0.1'
    }
});

export interface User {
    uuid: string;
    shortUuid: string;
    username: string;
    status: 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';
    expireAt: string;
    trafficLimitStrategy: string;
    hwidDeviceLimit: number | null;
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

export async function deleteAllHwidDevices(userUuid: string): Promise<void> {
    try {
        await apiClient.post(`/api/hwid/devices/delete-all`, { userUuid });
    } catch (error) {
        console.error(`Error deleting HWID devices for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export interface HwidDevice {
    hwid: string;
    platform: string | null;
    osVersion: string | null;
    deviceModel: string | null;
    userAgent: string | null;
    createdAt: string;
}

export async function getUserHwidDevices(userUuid: string): Promise<HwidDevice[]> {
    try {
        const response = await apiClient.get(`/api/hwid/devices/${userUuid}`);
        return response.data?.response?.devices || [];
    } catch (error) {
        console.error(`Error fetching HWID devices for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function deleteHwidDevice(userUuid: string, hwid: string): Promise<void> {
    try {
        await apiClient.post(`/api/hwid/devices/delete`, { userUuid, hwid });
    } catch (error) {
        console.error(`Error deleting HWID device ${hwid} for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}
