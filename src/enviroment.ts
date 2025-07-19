import type { IAgentRuntime } from '@elizaos/core';
import { z } from 'zod';

export const CONFIG_KEYS = {
    POLKADOT_PRIVATE_KEY: 'POLKADOT_PRIVATE_KEY',
    POLKADOT_RELAY_RPC_URL: 'POLKADOT_RELAY_RPC_URL',
    POLKADOT_ASSET_HUB_RPC_URL: 'POLKADOT_ASSET_HUB_RPC_URL',
    POLKADOT_RPC_API_KEY: 'POLKADOT_RPC_API_KEY',
    POLKADOT_MANIFEST_URL: 'POLKADOT_MANIFEST_URL',
    POLKADOT_BRIDGE_URL: 'POLKADOT_BRIDGE_URL',
    USE_CACHE_MANAGER: 'USE_CACHE_MANAGER',
    // Legacy support - deprecated
    POLKADOT_RPC_URL: 'POLKADOT_RPC_URL',
} as const;

// Full environment schema (includes private key for wallet operations)
export const envSchema = z.object({
    POLKADOT_PRIVATE_KEY: z.string().min(1, 'private key is required'),
    POLKADOT_RELAY_RPC_URL: z.string().optional(),
    POLKADOT_ASSET_HUB_RPC_URL: z.string().optional(),
    POLKADOT_RPC_API_KEY: z.string().optional(),
    POLKADOT_MANIFEST_URL: z.string().optional(),
    POLKADOT_BRIDGE_URL: z.string().optional(),
    // Legacy support - deprecated
    POLKADOT_RPC_URL: z.string().optional(),
});

// Network-only schema (for API service - no private key required)
export const networkConfigSchema = z.object({
    POLKADOT_RELAY_RPC_URL: z.string().optional(),
    POLKADOT_ASSET_HUB_RPC_URL: z.string().optional(),
    POLKADOT_RPC_API_KEY: z.string().optional(),
    // Legacy support - deprecated
    POLKADOT_RPC_URL: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
export type NetworkConfig = z.infer<typeof networkConfigSchema>;

// Full environment validation (for wallet operations)
export async function validateEnvConfig(runtime: IAgentRuntime): Promise<EnvConfig> {
    try {
        const config = {
            POLKADOT_PRIVATE_KEY:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_PRIVATE_KEY) ||
                process.env.POLKADOT_PRIVATE_KEY,
            POLKADOT_RELAY_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RELAY_RPC_URL) ||
                process.env.POLKADOT_RELAY_RPC_URL,
            POLKADOT_ASSET_HUB_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_ASSET_HUB_RPC_URL) ||
                process.env.POLKADOT_ASSET_HUB_RPC_URL,
            POLKADOT_RPC_API_KEY:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_API_KEY) ||
                process.env.POLKADOT_RPC_API_KEY,
            POLKADOT_MANIFEST_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_MANIFEST_URL) ||
                process.env.POLKADOT_MANIFEST_URL,
            POLKADOT_BRIDGE_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_BRIDGE_URL) ||
                process.env.POLKADOT_BRIDGE_URL,
            // Legacy support - fallback to old key
            POLKADOT_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_URL) || process.env.POLKADOT_RPC_URL,
        };

        return envSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join('.')}: ${err.message}`)
                .join('\n');
            throw new Error(`Polkadot configuration validation failed:\n${errorMessages}`);
        }
        throw error;
    }
}

// Network-only validation (for API service - no private key required)
export async function validateNetworkConfig(runtime: IAgentRuntime): Promise<NetworkConfig> {
    try {
        const config = {
            POLKADOT_RELAY_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RELAY_RPC_URL) ||
                process.env.POLKADOT_RELAY_RPC_URL,
            POLKADOT_ASSET_HUB_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_ASSET_HUB_RPC_URL) ||
                process.env.POLKADOT_ASSET_HUB_RPC_URL,
            POLKADOT_RPC_API_KEY:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_API_KEY) ||
                process.env.POLKADOT_RPC_API_KEY,
            // Legacy support - fallback to old key
            POLKADOT_RPC_URL:
                runtime.getSetting(CONFIG_KEYS.POLKADOT_RPC_URL) || process.env.POLKADOT_RPC_URL,
        };

        return networkConfigSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join('.')}: ${err.message}`)
                .join('\n');
            throw new Error(`Polkadot network configuration validation failed:\n${errorMessages}`);
        }
        throw error;
    }
}

/**
 * Get the custom RPC endpoint for a specific network type
 * Handles legacy POLKADOT_RPC_URL for backward compatibility
 */
export function getNetworkRpcUrl(
    networkConfig: NetworkConfig,
    networkType: 'relay' | 'asset-hub',
): string | undefined {
    switch (networkType) {
        case 'relay':
            // Try new key first, fallback to legacy for backward compatibility
            return networkConfig.POLKADOT_RELAY_RPC_URL || networkConfig.POLKADOT_RPC_URL;
        case 'asset-hub':
            return networkConfig.POLKADOT_ASSET_HUB_RPC_URL;
        default:
            return undefined;
    }
}
