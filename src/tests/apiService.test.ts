import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { PolkadotApiService, NetworkType } from '../services/api-service';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';

describe('PolkadotApiService', () => {
    let mockRuntime: IAgentRuntime;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockRuntime = {
            character: { name: 'TestAgent' },
            getSetting: vi.fn().mockImplementation((param) => {
                if (param === 'POLKADOT_RPC_URL') {
                    return POLKADOT_RPC_URL;
                }
                return null;
            }),
        } as unknown as IAgentRuntime;
    });

    afterEach(async () => {
        await PolkadotApiService.disconnectAll();
        vi.restoreAllMocks();
    });

    describe('Connection Management', () => {
        it('should establish relay connection', async () => {
            const api = await PolkadotApiService.getRelayConnection(mockRuntime);

            expect(api).toBeDefined();
            expect(api.isConnected).toBe(true);
            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(true);
        });

        it('should establish asset hub connection', async () => {
            const api = await PolkadotApiService.getAssetHubConnection(mockRuntime);

            expect(api).toBeDefined();
            expect(api.isConnected).toBe(true);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(true);
        });

        it('should reuse existing connections (singleton behavior)', async () => {
            const relay1 = await PolkadotApiService.getRelayConnection(mockRuntime);
            const relay2 = await PolkadotApiService.getRelayConnection(mockRuntime);

            expect(relay1).toBe(relay2);
        });

        it('should maintain separate connections for different networks', async () => {
            const relayApi = await PolkadotApiService.getRelayConnection(mockRuntime);
            const assetHubApi = await PolkadotApiService.getAssetHubConnection(mockRuntime);

            expect(relayApi).not.toBe(assetHubApi);
            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(true);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(true);
        });
    });

    describe('Connection Status', () => {
        it('should track individual network status correctly', async () => {
            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(false);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(false);

            await PolkadotApiService.getRelayConnection(mockRuntime);

            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(true);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(false);
        });

        it('should track both networks status correctly', async () => {
            expect(PolkadotApiService.areBothNetworksConnected()).toBe(false);

            await PolkadotApiService.getRelayConnection(mockRuntime);
            expect(PolkadotApiService.areBothNetworksConnected()).toBe(false);

            await PolkadotApiService.getAssetHubConnection(mockRuntime);
            expect(PolkadotApiService.areBothNetworksConnected()).toBe(true);
        });
    });

    describe('Batch Connection', () => {
        it('should connect both networks simultaneously', async () => {
            await PolkadotApiService.connectBothNetworks(mockRuntime);

            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(true);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(true);
            expect(PolkadotApiService.areBothNetworksConnected()).toBe(true);
        });
    });

    describe('Disconnection', () => {
        it('should disconnect specific networks', async () => {
            await PolkadotApiService.getRelayConnection(mockRuntime);
            await PolkadotApiService.getAssetHubConnection(mockRuntime);

            expect(PolkadotApiService.areBothNetworksConnected()).toBe(true);

            await PolkadotApiService.disconnect(NetworkType.RELAY);

            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(false);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(true);
        });

        it('should disconnect all networks', async () => {
            await PolkadotApiService.connectBothNetworks(mockRuntime);
            expect(PolkadotApiService.areBothNetworksConnected()).toBe(true);

            await PolkadotApiService.disconnectAll();

            expect(PolkadotApiService.isConnected(NetworkType.RELAY)).toBe(false);
            expect(PolkadotApiService.isConnected(NetworkType.ASSET_HUB)).toBe(false);
            expect(PolkadotApiService.areBothNetworksConnected()).toBe(false);
        });
    });
});
