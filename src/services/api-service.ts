import { logger } from '@elizaos/core';
import { ApiPromise, WsProvider } from '@polkadot/api';
import type { ApiOptions } from '@polkadot/api/types';
import { validateNetworkConfig, getNetworkRpcUrl } from '../enviroment';
import { IAgentRuntime } from '@elizaos/core';

export enum NetworkType {
    RELAY = 'relay',
    ASSET_HUB = 'asset-hub',
}

interface NetworkConfig {
    DEFAULT_ENDPOINT: string;
    BACKUP_ENDPOINTS: string[];
    MAX_RETRIES: number;
    RETRY_DELAY: number;
}

const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
    [NetworkType.RELAY]: {
        DEFAULT_ENDPOINT: 'wss://rpc.polkadot.io',
        BACKUP_ENDPOINTS: [
            'wss://polkadot-rpc.dwellir.com',
            'wss://polkadot.api.onfinality.io/public-ws',
            'wss://rpc.ibp.network/polkadot',
        ],
        MAX_RETRIES: 3,
        RETRY_DELAY: 3000,
    },
    [NetworkType.ASSET_HUB]: {
        DEFAULT_ENDPOINT: 'wss://polkadot-asset-hub-rpc.polkadot.io',
        BACKUP_ENDPOINTS: [
            'wss://asset-hub-polkadot-rpc.dwellir.com',
            'wss://polkadot-asset-hub.api.onfinality.io/public-ws',
        ],
        MAX_RETRIES: 3,
        RETRY_DELAY: 3000,
    },
};

/**
 * Static utility for managing Polkadot network connections
 *
 * Primary usage:
 * - `PolkadotApiService.getRelayConnection(runtime)` - For relay chain operations
 * - `PolkadotApiService.getAssetHubConnection(runtime)` - For Asset Hub operations
 */
export class PolkadotApiService {
    static serviceType = 'polkadot_api' as const;
    capabilityDescription = 'The agent is able to interact with the Polkadot API';

    private static connections: Map<NetworkType, ApiPromise> = new Map();
    private static providers: Map<NetworkType, WsProvider> = new Map();
    private static connecting: Map<NetworkType, Promise<ApiPromise>> = new Map();

    // ============================================================================
    // MAIN PUBLIC API
    // ============================================================================

    /**
     * Get a RELAY chain connection (lazy loading)
     */
    static async getRelayConnection(runtime: IAgentRuntime): Promise<ApiPromise> {
        return PolkadotApiService.getConnection(runtime, NetworkType.RELAY);
    }

    /**
     * Get an ASSET_HUB connection (lazy loading)
     */
    static async getAssetHubConnection(runtime: IAgentRuntime): Promise<ApiPromise> {
        return PolkadotApiService.getConnection(runtime, NetworkType.ASSET_HUB);
    }

    /**
     * Connect to both networks
     * Throws if either connection fails
     */
    static async connectBothNetworks(runtime: IAgentRuntime): Promise<void> {
        const results = await Promise.allSettled([
            PolkadotApiService.getConnection(runtime, NetworkType.RELAY),
            PolkadotApiService.getConnection(runtime, NetworkType.ASSET_HUB),
        ]);

        const failures = results
            .map((result, index) => ({
                network: index === 0 ? NetworkType.RELAY : NetworkType.ASSET_HUB,
                result,
            }))
            .filter(({ result }) => result.status === 'rejected')
            .map(
                ({ network, result }) =>
                    `${network}: ${result.status === 'rejected' ? result.reason : 'Unknown error'}`,
            );

        if (failures.length > 0) {
            throw new Error(`Failed to connect networks: ${failures.join(', ')}`);
        }
    }

    // ============================================================================
    // CONNECTION MANAGEMENT
    // ============================================================================

    /**
     * Get connection for any network type (internal method)
     */
    private static async getConnection(
        runtime: IAgentRuntime,
        networkType: NetworkType,
    ): Promise<ApiPromise> {
        // Return existing connection if available
        const existingConnection = PolkadotApiService.connections.get(networkType);
        if (existingConnection?.isConnected) {
            return existingConnection;
        }

        // Return existing connection promise if already connecting
        const existingPromise = PolkadotApiService.connecting.get(networkType);
        if (existingPromise) {
            return existingPromise;
        }

        // Start new connection
        const connectionPromise = PolkadotApiService.createConnection(runtime, networkType);
        PolkadotApiService.connecting.set(networkType, connectionPromise);

        try {
            const connection = await connectionPromise;
            PolkadotApiService.connections.set(networkType, connection);
            return connection;
        } finally {
            PolkadotApiService.connecting.delete(networkType);
        }
    }

    /**
     * Create a new connection with retry logic
     */
    private static async createConnection(
        runtime: IAgentRuntime,
        networkType: NetworkType,
    ): Promise<ApiPromise> {
        const config = await PolkadotApiService.getNetworkConfig(runtime, networkType);
        const endpoints = [config.DEFAULT_ENDPOINT, ...config.BACKUP_ENDPOINTS];

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < config.MAX_RETRIES; attempt++) {
            for (const endpoint of endpoints) {
                try {
                    logger.debug(
                        `Connecting to ${networkType} at ${endpoint} (attempt ${attempt + 1})`,
                    );

                    const provider = new WsProvider(endpoint);

                    // Create connection with proper signed extensions based on network type
                    const apiConfig = PolkadotApiService.getApiConfig(networkType, provider);
                    const connectionPromise = ApiPromise.create(apiConfig);
                    const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Connection timeout after 15s')), 15000),
                    );

                    const api = await Promise.race([connectionPromise, timeoutPromise]);

                    PolkadotApiService.providers.set(networkType, provider);
                    logger.debug(`Connected to ${networkType} at ${endpoint}`);

                    return api;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    logger.warn(
                        `Failed to connect to ${networkType} at ${endpoint}: ${lastError.message}`,
                    );
                }
            }

            // Only retry if we have more attempts (no delay on single endpoint)
            if (attempt < config.MAX_RETRIES - 1 && endpoints.length > 1) {
                const delay = 500; // Much shorter delay
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        throw new Error(
            `Failed to connect to ${networkType} after ${config.MAX_RETRIES} attempts. Last error: ${lastError?.message}`,
        );
    }

    /**
     * Get API configuration with appropriate signed extensions for each network type
     */
    private static getApiConfig(networkType: NetworkType, provider: WsProvider): ApiOptions {
        const baseConfig: ApiOptions = { provider };

        if (networkType === NetworkType.ASSET_HUB) {
            // Asset Hub requires ChargeAssetTxPayment for asset-based fee payment
            return {
                ...baseConfig,
                signedExtensions: {
                    ChargeAssetTxPayment: {
                        extrinsic: {
                            tip: 'Compact<Balance>',
                            assetId: 'Option<MultiLocation>',
                        },
                        payload: {},
                    },
                },
            } as ApiOptions;
        }

        // Relay chain uses default configuration
        return baseConfig;
    }

    /**
     * Get network configuration with environment overrides
     */
    private static async getNetworkConfig(
        runtime: IAgentRuntime,
        networkType: NetworkType,
    ): Promise<NetworkConfig> {
        const config = { ...NETWORK_CONFIGS[networkType] };

        try {
            const networkConfig = await validateNetworkConfig(runtime);
            const customEndpoint = getNetworkRpcUrl(networkConfig, networkType);

            if (customEndpoint) {
                config.DEFAULT_ENDPOINT = customEndpoint;
                // Clear backup endpoints when using custom endpoint to avoid fallback in tests
                config.BACKUP_ENDPOINTS = [];
                logger.debug(`Using custom ${networkType} endpoint: ${customEndpoint}`);
            }
        } catch (_error) {
            logger.warn(`Failed to load custom config for ${networkType}, using defaults`);
        }

        return config;
    }

    // ============================================================================
    // STATUS AND CLEANUP
    // ============================================================================

    /**
     * Check if a specific network is connected
     */
    static isConnected(networkType: NetworkType): boolean {
        const connection = PolkadotApiService.connections.get(networkType);
        return !!connection && connection.isConnected;
    }

    /**
     * Check if both networks are connected
     */
    static areBothNetworksConnected(): boolean {
        return (
            PolkadotApiService.isConnected(NetworkType.RELAY) &&
            PolkadotApiService.isConnected(NetworkType.ASSET_HUB)
        );
    }

    /**
     * Disconnect a specific network
     */
    static async disconnect(networkType: NetworkType): Promise<void> {
        const connection = PolkadotApiService.connections.get(networkType);
        const provider = PolkadotApiService.providers.get(networkType);

        if (connection) {
            await connection.disconnect();
            PolkadotApiService.connections.delete(networkType);
        }

        if (provider) {
            provider.disconnect();
            PolkadotApiService.providers.delete(networkType);
        }

        logger.debug(`Disconnected from ${networkType}`);
    }

    /**
     * Disconnect all networks
     */
    static async disconnectAll(): Promise<void> {
        const disconnectPromises = [
            PolkadotApiService.disconnect(NetworkType.RELAY),
            PolkadotApiService.disconnect(NetworkType.ASSET_HUB),
        ];

        await Promise.all(disconnectPromises);
        logger.debug('Disconnected from all networks');
    }
}

export default PolkadotApiService;
