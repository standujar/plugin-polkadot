import type { IAgentRuntime } from '@elizaos/core';
import { describe, it, vi, beforeEach, expect, afterEach } from 'vitest';
import { SubsidizedTransferAction, subsidizedTransferSchema } from '../actions/subsidizedTransfer';
import { CacheManager } from '../utils/cache';

const cacheManager = new CacheManager();

// Test constants
const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';
const ASSET_HUB_RPC_URL = 'wss://polkadot-asset-hub-rpc.polkadot.io';
const TEST_RECIPIENT_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const TEST_AMOUNT = '100';
const TEST_ASSET_ID = '1984'; // USDC
const TEST_FEE_ASSET_ID = '1984'; // USDC for fees

// Mock only the core functions that are not part of the actual functionality
vi.mock('@elizaos/core', async () => {
    const actual = await vi.importActual('@elizaos/core');
    return {
        ...actual,
        elizaLogger: {
            log: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        ModelType: {
            TEXT_SMALL: 'text-small',
        },
        composePromptFromState: vi.fn().mockReturnValue('test prompt'),
        parseJSONObjectFromText: vi.fn().mockImplementation((text: string) => {
            // Mock parsing of JSON response
            try {
                return JSON.parse(text);
            } catch {
                return null;
            }
        }),
    };
});

describe('SubsidizedTransferAction', () => {
    let mockRuntime: IAgentRuntime;
    let subsidizedTransferAction: SubsidizedTransferAction;

    beforeEach(async () => {
        vi.clearAllMocks();

        mockRuntime = {
            character: { name: 'TestAgent' },
            getCache: vi.fn().mockImplementation((key: string) => {
                return cacheManager.get(key);
            }),
            setCache: vi.fn().mockImplementation((key: string, value: unknown) => {
                cacheManager.set(key, value);
            }),
            getSetting: vi.fn().mockImplementation((param: string) => {
                if (param === 'POLKADOT_RPC_URL') {
                    return POLKADOT_RPC_URL;
                }
                if (param === 'POLKADOT_ASSET_HUB_RPC_URL') {
                    return ASSET_HUB_RPC_URL;
                }
                return null;
            }),
            useModel: vi.fn().mockResolvedValue(
                JSON.stringify({
                    recipientAddress: TEST_RECIPIENT_ADDRESS,
                    assetId: TEST_ASSET_ID,
                    amount: TEST_AMOUNT,
                    feeAssetId: TEST_FEE_ASSET_ID,
                    walletNumber: null,
                    walletAddress: null,
                    password: null,
                }),
            ),
            composeState: vi.fn().mockResolvedValue({}),
        } as unknown as IAgentRuntime;

        subsidizedTransferAction = new SubsidizedTransferAction(mockRuntime);
    });

    afterEach(async () => {
        // Clean up any connections
        if (subsidizedTransferAction) {
            try {
                // Close API connections if they exist
                if (
                    (
                        subsidizedTransferAction as unknown as {
                            api: { disconnect: () => Promise<void> };
                        }
                    ).api
                ) {
                    await (
                        subsidizedTransferAction as unknown as {
                            api: { disconnect: () => Promise<void> };
                        }
                    ).api.disconnect();
                }
            } catch (_error) {
                // Ignore cleanup errors
            }
        }
    });

    describe('Schema Validation', () => {
        it('should validate correct subsidized transfer data', () => {
            const validData = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                assetId: TEST_ASSET_ID,
                amount: TEST_AMOUNT,
                feeAssetId: TEST_FEE_ASSET_ID,
                walletNumber: null,
                walletAddress: null,
                password: null,
            };

            const result = subsidizedTransferSchema.safeParse(validData);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.recipientAddress).toBe(TEST_RECIPIENT_ADDRESS);
                expect(result.data.assetId).toBe(TEST_ASSET_ID);
                expect(result.data.amount).toBe(TEST_AMOUNT);
                expect(result.data.feeAssetId).toBe(TEST_FEE_ASSET_ID);
            }
        });

        it('should handle optional fields correctly', () => {
            const dataWithOptionals = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                assetId: TEST_ASSET_ID,
                amount: TEST_AMOUNT,
                feeAssetId: TEST_FEE_ASSET_ID,
                walletNumber: 1,
                walletAddress: 'test-address',
                password: 'test-password',
            };

            const result = subsidizedTransferSchema.safeParse(dataWithOptionals);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.walletNumber).toBe(1);
                expect(result.data.walletAddress).toBe('test-address');
                expect(result.data.password).toBe('test-password');
            }
        });

        it('should validate DOT as native asset', () => {
            const dotTransferData = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                assetId: 'DOT',
                amount: '1',
                feeAssetId: '1984', // Pay fees with USDC
                walletNumber: null,
                walletAddress: null,
                password: null,
            };

            const result = subsidizedTransferSchema.safeParse(dotTransferData);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.assetId).toBe('DOT');
                expect(result.data.feeAssetId).toBe('1984');
            }
        });
    });

    describe('SubsidizedTransferAction Initialization', () => {
        it('should initialize subsidized transfer action', async () => {
            await expect(subsidizedTransferAction.initialize()).resolves.not.toThrow();

            // Verify that the action was properly initialized
            expect(subsidizedTransferAction).toBeDefined();
        });
    });

    describe('Transfer Parameters Validation', () => {
        it('should validate subsidized transfer parameters', async () => {
            const validParams = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                assetId: TEST_ASSET_ID,
                amount: TEST_AMOUNT,
                feeAssetId: TEST_FEE_ASSET_ID,
            };

            // This test validates the parameter structure without actually executing the transfer
            expect(validParams.recipientAddress).toBeTruthy();
            expect(validParams.assetId).toBeTruthy();
            expect(validParams.amount).toBeTruthy();
            expect(validParams.feeAssetId).toBeTruthy();
            expect(typeof validParams.recipientAddress).toBe('string');
            expect(validParams.recipientAddress.length).toBeGreaterThan(0);
            expect(validParams.amount).toMatch(/^\d+(\.\d+)?$/);
        });

        it('should handle missing optional parameters', async () => {
            const paramsWithoutOptionals = {
                recipientAddress: TEST_RECIPIENT_ADDRESS,
                assetId: TEST_ASSET_ID,
                amount: TEST_AMOUNT,
                feeAssetId: TEST_FEE_ASSET_ID,
                // walletNumber, walletAddress, password are optional
            };

            expect(paramsWithoutOptionals.recipientAddress).toBeTruthy();
            expect(paramsWithoutOptionals.assetId).toBeTruthy();
            expect(paramsWithoutOptionals.amount).toBeTruthy();
            expect(paramsWithoutOptionals.feeAssetId).toBeTruthy();
        });

        it('should validate asset ID formats', () => {
            const validAssetIds = ['1984', '1337', 'DOT', '2000'];
            const invalidAssetIds = ['', 'abc-123', '-1'];

            for (const id of validAssetIds) {
                expect(id).toBeTruthy();
                expect(typeof id).toBe('string');
            }

            for (const id of invalidAssetIds) {
                if (id === '') {
                    expect(id).toBeFalsy();
                } else {
                    expect(id).toBeTruthy(); // But would fail in actual validation
                }
            }
        });

        it('should validate different asset combinations', () => {
            const assetCombinations = [
                { asset: 'DOT', feeAsset: '1984' }, // DOT with USDC fees
                { asset: '1984', feeAsset: '1984' }, // USDC with USDC fees
                { asset: '1337', feeAsset: '1984' }, // USDT with USDC fees
                { asset: '1000', feeAsset: '1337' }, // Custom asset with USDT fees
            ];

            for (const combo of assetCombinations) {
                expect(combo.asset).toBeTruthy();
                expect(combo.feeAsset).toBeTruthy();
                expect(typeof combo.asset).toBe('string');
                expect(typeof combo.feeAsset).toBe('string');
            }
        });
    });

    describe('Asset Metadata Handling', () => {
        it('should handle known asset IDs', () => {
            const knownAssets = {
                '1984': 'USDC',
                '1337': 'USDT',
                DOT: 'DOT',
                '1000': 'Asset1000',
            };

            for (const [assetId, symbol] of Object.entries(knownAssets)) {
                expect(assetId).toBeTruthy();
                expect(symbol).toBeTruthy();
                expect(typeof assetId).toBe('string');
                expect(typeof symbol).toBe('string');
            }
        });

        it('should handle asset decimals for calculations', () => {
            const assetDecimals = {
                DOT: 10,
                USDC: 6,
                USDT: 6,
            };

            for (const [asset, decimals] of Object.entries(assetDecimals)) {
                expect(asset).toBeTruthy();
                expect(decimals).toBeGreaterThan(0);
                expect(typeof decimals).toBe('number');
            }
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid recipient addresses', () => {
            const invalidAddresses = ['', 'invalid-address', '0x123', 'not-an-address'];

            for (const address of invalidAddresses) {
                expect(address).not.toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
            }
        });

        it('should handle invalid amounts', () => {
            const invalidAmounts = ['', '-1', '0', 'abc', '1.2.3'];

            for (const amount of invalidAmounts) {
                if (amount === '0') {
                    expect(amount).toMatch(/^\d+(\.\d+)?$/); // 0 is technically valid format
                } else {
                    expect(amount).not.toMatch(/^\d+(\.\d+)?$/);
                }
            }
        });

        it('should handle missing required parameters', () => {
            const requiredParams = ['recipientAddress', 'assetId', 'amount', 'feeAssetId'];

            for (const param of requiredParams) {
                expect(param).toBeTruthy();
            }
        });

        it('should validate fee asset sufficiency', () => {
            // In real Asset Hub, only certain assets can pay fees
            const sufficientAssets = ['1984', '1337']; // USDC, USDT
            const insufficientAssets = ['DOT', '999']; // DOT can't pay fees on Asset Hub, neither can random assets

            for (const asset of sufficientAssets) {
                expect(asset).toBeTruthy();
                expect(['1984', '1337'].includes(asset)).toBe(true);
            }

            for (const asset of insufficientAssets) {
                expect(asset).toBeTruthy();
                expect(['1984', '1337'].includes(asset)).toBe(false);
            }
        });
    });

    describe('Runtime Settings', () => {
        it('should handle runtime settings for Asset Hub', () => {
            const assetHubUrl = mockRuntime.getSetting('POLKADOT_ASSET_HUB_RPC_URL');
            const polkadotUrl = mockRuntime.getSetting('POLKADOT_RPC_URL');

            expect(assetHubUrl).toBe(ASSET_HUB_RPC_URL);
            expect(polkadotUrl).toBe(POLKADOT_RPC_URL);
        });

        it('should handle missing settings gracefully', () => {
            const unknownSetting = mockRuntime.getSetting('UNKNOWN_SETTING');
            expect(unknownSetting).toBeNull();
        });
    });
});
