import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.REMNAWAVE_API_URL;
const API_KEY = process.env.REMNAWAVE_X_API_KEY;

const TRAFFILK_API_URL = process.env.TRAFFILK_API_URL;
const TRAFFILK_API_KEY = process.env.TRAFFILK_API_KEY;

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

const traffilkClient = axios.create({
    baseURL: TRAFFILK_API_URL,
    headers: {
        'Authorization': `Bearer ${TRAFFILK_API_KEY}`,
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
    hwidDeviceLimit: number | null;
    telegramId: number | null;
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

export async function getAllUsers(): Promise<User[]> {
    const allUsers: User[] = [];
    let start = 0;
    const size = 50;

    while (true) {
        try {
            const response = await apiClient.get(`/api/users`, { params: { start, size } });
            const users = response.data?.response?.users || [];
            if (users.length === 0) {
                break;
            }
            allUsers.push(...users);
            start += size;
            
            // Safety check to prevent infinite loops in case of API bug
            if (users.length < size) {
                break;
            }
        } catch (error) {
            console.error(`Error fetching users batch at start ${start}:`, error instanceof AxiosError ? error.message : error);
            break;
        }
    }
    return allUsers;
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

export interface SubscriptionSettings {
    hwidSettings?: {
        enabled: boolean;
        fallbackDeviceLimit: number;
        maxDevicesAnnounce: string | null;
    } | null;
}

export async function getSubscriptionSettings(): Promise<SubscriptionSettings | null> {
    try {
        const response = await apiClient.get(`/api/subscription-settings`);
        return response.data?.response as SubscriptionSettings;
    } catch (error) {
        console.error(`Error fetching subscription settings:`, error instanceof AxiosError ? error.message : error);
        return null;
    }
}

export async function revokeUserSubscription(userUuid: string): Promise<void> {
    try {
        await apiClient.post(`/api/users/${userUuid}/actions/revoke`, {});
    } catch (error) {
        console.error(`Error revoking subscription for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function extendUserSubscription(userUuid: string, days: number): Promise<void> {
    try {
        if (days === 2099) {
            const expireAtDate = new Date();
            expireAtDate.setFullYear(2099);
            await apiClient.post(`/api/users/bulk/update`, {
                uuids: [userUuid],
                fields: {
                    expireAt: expireAtDate.toISOString(),
                    status: 'ACTIVE'
                }
            });
            return;
        }

        await apiClient.post(`/api/users/bulk/extend-expiration-date`, {
            uuids: [userUuid],
            extendDays: days
        });
        
        // Also ensure the user is ACTIVE
        await apiClient.post(`/api/users/bulk/update`, {
            uuids: [userUuid],
            fields: {
                status: 'ACTIVE'
            }
        });
    } catch (error) {
        console.error(`Error extending subscription for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}
  
export async function createUser(username: string, days: number, telegramId?: number): Promise<void> {
    try {
        const expireAtDate = new Date();
        if (days === 2099) {
            expireAtDate.setFullYear(2099);
        } else {
            expireAtDate.setDate(expireAtDate.getDate() + days);
        }
        const payload: any = { username, expireAt: expireAtDate.toISOString(), status: 'ACTIVE' };
        if (telegramId) payload.telegramId = telegramId;
        await apiClient.post(`/api/users`, payload);
    } catch (error) {
        console.error(`Error creating user ${username}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function changeUserStatus(userUuid: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
    try {
        await apiClient.post(`/api/users/bulk/update`, {
            uuids: [userUuid],
            fields: { status }
        });
    } catch (error) {
        console.error(`Error changing status for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function deleteUser(userUuid: string): Promise<void> {
    try {
        await apiClient.delete(`/api/users/${userUuid}`);
    } catch (error) {
        console.error(`Error deleting user ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export interface NodeItem {
    uuid: string;
    name: string;
    isConnected: boolean;
    isDisabled: boolean;
    usersOnline: number;
    isTrafficTrackingActive: boolean;
    trafficResetDay: number;
    trafficLimitBytes: number;
    trafficUsedBytes: number;
    system?: {
        info?: {
            memoryTotal: number;
        };
        stats?: {
            memoryUsed: number;
            uptime: number;
            loadAvg: number[];
            interface?: {
                rxBytesPerSec: number;
                txBytesPerSec: number;
            };
        };
    };
}

export async function resetUserTraffic(userUuid: string): Promise<void> {
    try {
        await apiClient.post(`/api/users/${userUuid}/actions/reset-traffic`);
    } catch (error) {
        console.error(`Error resetting traffic for ${userUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function getAllNodes(): Promise<NodeItem[]> {
    try {
        const response = await apiClient.get('/api/nodes');
        return response.data?.response as NodeItem[];
    } catch (error) {
        console.error(`Error fetching nodes:`, error instanceof AxiosError ? error.message : error);
        return [];
    }
}

export async function restartAllNodes(): Promise<void> {
    try {
        await apiClient.post('/api/nodes/actions/restart-all');
    } catch (error) {
        console.error(`Error restarting all nodes:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export async function restartNode(nodeUuid: string): Promise<void> {
    try {
        await apiClient.post(`/api/nodes/${nodeUuid}/actions/restart`);
    } catch (error) {
        console.error(`Error restarting node ${nodeUuid}:`, error instanceof AxiosError ? error.message : error);
        throw error;
    }
}

export interface TraffilkNode {
    id: number;
    name: string;
    url: string;
    status: string;
    trafficUsedBytes: number;
    trafficLimitBytes: number;
    isTrafficTrackingActive: boolean;
    trafficResetDay: number;
    rxBytesPerSec: number;
    txBytesPerSec: number;
    cpuLoadPercent: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    memTotalBytes: number;
    memUsedBytes: number;
    uptimeSeconds: number;
    netDropsRx: number;
    netDropsTx: number;
    fileDescriptors: number;
    tcpConnections: number;
}

export async function getTraffilkNodes(): Promise<TraffilkNode[]> {
    try {
        const response = await traffilkClient.get('/api/traffilk/nodes');
        return response.data as TraffilkNode[];
    } catch (error) {
        console.error(`Error fetching Traffilk nodes:`, error instanceof AxiosError ? error.message : error);
        return [];
    }
} 
