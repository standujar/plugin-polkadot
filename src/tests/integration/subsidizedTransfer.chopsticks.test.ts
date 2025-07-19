import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import type { IAgentRuntime } from '@elizaos/core';
import { SubsidizedTransferAction } from '../../actions/subsidizedTransfer';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { toBaseUnits } from 'src/utils';

const TEST_SENDER_MNEMONIC =
    'away basket broccoli urge waste duck attack walk detect govern orchard sound';
const TEST_SENDER_ADDRESS = '5Ft3qZ9N8FCuuLCfaeW1EBtNxTzC7ExfysUm9qBwycYefcpM';

const USDT_ASSET_ID = 1337;
const USDC_ASSET_ID = 1984;

const CHOPSTICKS_URL = 'ws://localhost:8000';
const CHOPSTICKS_CONFIG_FILE = 'chopsticks-assethub-config.yml';
const CHOPSTICKS_WAIT_TIMEOUT = 20000; // 20 seconds

let chopsticksProcess: ChildProcess | undefined;

describe('Asset Transfer', () => {
    let api: ApiPromise;
    let bob: ReturnType<Keyring['addFromUri']>;
    let mockRuntime: IAgentRuntime;

    beforeAll(async () => {
        // Start Chopsticks subprocess
        chopsticksProcess = spawn('npx', ['chopsticks', `--config=${CHOPSTICKS_CONFIG_FILE}`]);

        // Wait for WebSocket to be ready
        await waitForWs(CHOPSTICKS_URL, CHOPSTICKS_WAIT_TIMEOUT);

        // Connect to Chopsticks
        api = await ApiPromise.create({
            provider: new WsProvider(CHOPSTICKS_URL),
        });

        const keyring = new Keyring({ type: 'sr25519' });
        bob = keyring.addFromUri('//Bob');

        await setupBalances();

        mockRuntime = {
            character: { name: 'TestAgent' },
            getSetting: vi.fn().mockImplementation((key: string) => {
                if (key === 'POLKADOT_PRIVATE_KEY') return TEST_SENDER_MNEMONIC;
                if (key === 'POLKADOT_RPC_URL') return CHOPSTICKS_URL;
                if (key === 'POLKADOT_ASSET_HUB_RPC_URL') return CHOPSTICKS_URL;
                return null;
            }),
            logger: {
                log: vi.fn(),
                debug: vi.fn(),
                error: vi.fn(),
            },
        } as unknown as IAgentRuntime;
    });

    afterAll(async () => {
        await api?.disconnect();
        if (chopsticksProcess) chopsticksProcess.kill();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should transfer USDC and pay txfee with USDT', async () => {
        vi.doMock('../services/api-service', () => ({
            PolkadotApiService: {
                getAssetHubConnection: vi.fn().mockResolvedValue(api),
            },
        }));

        const action = new SubsidizedTransferAction(mockRuntime);
        await action.initialize();

        const senderUSDCBalanceBefore = await getAssetBalance(USDC_ASSET_ID, TEST_SENDER_ADDRESS);
        const senderUSDTBalanceBefore = await getAssetBalance(USDT_ASSET_ID, TEST_SENDER_ADDRESS);
        const bobUSDCBalanceBefore = await getAssetBalance(USDC_ASSET_ID, bob.address);
        console.log(`Sender USDC Balance Before: ${senderUSDCBalanceBefore}`);
        console.log(`Sender USDT Balance Before: ${senderUSDTBalanceBefore}`);
        console.log(`Bob USDC Balance Before: ${bobUSDCBalanceBefore}`);

        const amountToTransfer = 10; // Amount in USDC to transfer
        const _result = await action.subsidizedTransfer({
            recipientAddress: bob.address,
            assetId: USDC_ASSET_ID.toString(),
            amount: amountToTransfer.toString(),
            feeAssetId: USDT_ASSET_ID.toString(),
            dryRun: false,
        });

        const senderUSDCBalanceAfter = await getAssetBalance(USDC_ASSET_ID, TEST_SENDER_ADDRESS);
        const senderUSDTBalanceAfter = await getAssetBalance(USDT_ASSET_ID, TEST_SENDER_ADDRESS);
        const bobUSDCBalanceAfter = await getAssetBalance(USDC_ASSET_ID, bob.address);
        console.log(`Sender USDC Balance After: ${senderUSDCBalanceAfter}`);
        console.log(`Sender USDT Balance After: ${senderUSDTBalanceAfter}`);
        console.log(`Bob USDC Balance After: ${bobUSDCBalanceAfter}`);

        // Bob gets 10 USDC
        expect(BigInt(bobUSDCBalanceAfter)).toBe(
            BigInt(bobUSDCBalanceBefore) +
                (await toBaseUnits(api, USDC_ASSET_ID, amountToTransfer)),
        );
        // Sender loses 10 USDC
        expect(BigInt(senderUSDCBalanceAfter)).toBe(
            BigInt(senderUSDCBalanceBefore) -
                (await toBaseUnits(api, USDC_ASSET_ID, amountToTransfer)),
        );
        // Sender pays tx fee in USDT
        expect(BigInt(senderUSDTBalanceAfter) < BigInt(senderUSDTBalanceBefore)).toBeTruthy();
    });

    it('should transfer DOT and pay txfee with USDC', async () => {
        vi.doMock('../services/api-service', () => ({
            PolkadotApiService: {
                getAssetHubConnection: vi.fn().mockResolvedValue(api),
            },
        }));

        const action = new SubsidizedTransferAction(mockRuntime);
        await action.initialize();

        const senderDOTBalanceBefore = await getDOTBalance(TEST_SENDER_ADDRESS);
        const senderUSDCBalanceBefore = await getAssetBalance(USDC_ASSET_ID, TEST_SENDER_ADDRESS);
        const bobDOTBalanceBefore = await getDOTBalance(bob.address);

        console.log(`Sender DOT Balance Before: ${senderDOTBalanceBefore}`);
        console.log(`Sender USDC Balance Before: ${senderUSDCBalanceBefore}`);
        console.log(`Bob DOT Balance Before: ${bobDOTBalanceBefore}`);

        const amountToTransfer = 1; // Amount in DOT to transfer
        const _result = await action.subsidizedTransfer({
            recipientAddress: bob.address,
            assetId: 'DOT',
            amount: amountToTransfer.toString(),
            feeAssetId: USDC_ASSET_ID.toString(),
            dryRun: false,
        });

        const senderDOTBalanceAfter = await getDOTBalance(TEST_SENDER_ADDRESS);
        const senderUSDCBalanceAfter = await getAssetBalance(USDC_ASSET_ID, TEST_SENDER_ADDRESS);
        const bobDOTBalanceAfter = await getDOTBalance(bob.address);

        console.log(`Sender DOT Balance After: ${senderDOTBalanceAfter}`);
        console.log(`Sender USDC Balance After: ${senderUSDCBalanceAfter}`);
        console.log(`Bob DOT Balance After: ${bobDOTBalanceAfter}`);

        // Bob gets 1 DOT
        expect(BigInt(bobDOTBalanceAfter)).toBe(
            BigInt(bobDOTBalanceBefore) + (await toBaseUnits(api, 'DOT', amountToTransfer)),
        );
        // Sender loses 1 DOT
        expect(BigInt(senderDOTBalanceAfter)).toBe(
            BigInt(senderDOTBalanceBefore) - (await toBaseUnits(api, 'DOT', amountToTransfer)),
        );
        // Sender pays tx fee in USDC
        expect(BigInt(senderUSDCBalanceAfter) < BigInt(senderUSDCBalanceBefore)).toBeTruthy();
    });

    // Add this helper function after the existing getAssetBalance function
    async function getDOTBalance(address: string): Promise<string> {
        const account = await api.query.system.account(address);
        return (
            account as unknown as { data: { free: { toString(): string } } }
        ).data.free.toString();
    }

    async function getAssetBalance(assetId: number, address: string): Promise<string> {
        const account = await api.query.assets.account(assetId, address);
        const typedAccount = account as unknown as {
            isSome: boolean;
            unwrap(): { balance: { toString(): string } };
        };
        return typedAccount.isSome ? typedAccount.unwrap().balance.toString() : '0';
    }

    async function setupBalances(): Promise<void> {
        const storage = {
            System: {
                Account: [
                    [
                        [TEST_SENDER_ADDRESS],
                        {
                            providers: 1,
                            data: {
                                free: '100000000000',
                                reserved: '0',
                                miscFrozen: '0',
                                feeFrozen: '0',
                            },
                        },
                    ],
                ],
            },
            Assets: {
                Account: [
                    [[USDC_ASSET_ID, TEST_SENDER_ADDRESS], { balance: '19000000000000000' }],
                    [[USDT_ASSET_ID, TEST_SENDER_ADDRESS], { balance: '50000000000' }],
                ],
            },
        };

        await api.rpc('dev_setStorage', storage);
    }

    async function waitForWs(url: string, timeoutMs = 20000): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                await new Promise<boolean>((resolve, reject) => {
                    const ws = new WebSocket(url);
                    ws.on('open', () => {
                        ws.terminate();
                        resolve(true);
                    });
                    ws.on('error', reject);
                });
                return;
            } catch {
                await new Promise((r) => setTimeout(r, 250));
            }
        }
        throw new Error('WebSocket connection to Chopsticks failed to open.');
    }
});
