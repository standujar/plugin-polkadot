import type { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';
import {
    elizaLogger,
    ModelType,
    composePromptFromState,
    parseJSONObjectFromText,
} from '@elizaos/core';
import { WalletProvider, initWalletProvider } from '../providers/wallet';
import { z } from 'zod';
import { PolkadotApiService } from '../services/api-service';
import { toBaseUnits, getAssetMetadata } from '../utils';

export interface SubsidizedTransferContent extends Content {
    recipientAddress: string;
    assetId: string;
    amount: string;
    feeAssetId: string;
    walletNumber?: number;
    walletAddress?: string;
    password?: string;
}

// Define a schema for input JSON
export const subsidizedTransferSchema = z.object({
    recipientAddress: z.string(),
    assetId: z.string(),
    amount: z.string(),
    feeAssetId: z.string(),
    walletNumber: z.number().optional().nullable(),
    walletAddress: z.string().optional().nullable(),
    password: z.string().optional().nullable(),
});

// Define a template to guide object building
export const subsidizedTransferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.
  Example response:
  \`\`\`json
  {
    "recipientAddress": "<recipient address>",
    "assetId": "<asset ID to transfer (e.g., '1984' for USDC, '1337' for USDT, or 'DOT' for native DOT)>",
    "amount": "<numeric amount only, without asset symbol>",
    "feeAssetId": "<asset ID to pay fees with (e.g., '1984' for USDC, '1337' for USDT. or 'DOT' for native DOT)>",
    "walletNumber": <optional wallet number>,
    "walletAddress": "<optional wallet address>",
    "password": "<optional password>"
  }
  \`\`\`
  
  {{recentMessages}}

  If a wallet number or address is not provided in the latest message, return null for those values.
  If a password is not provided in the latest message, return null for the password.
  If no fee asset is specified, default to DOT for fee payment.
  
  IMPORTANT: 
  - For the "amount" field, extract ONLY the numeric value without any asset symbols or currency names.
  - Common Asset Hub asset IDs: USDC = "1984", USDT = "1337", DOT = "DOT"
  - The feeAssetId should be a sufficient asset that can pay for transaction fees (either USDC or USDT)
  - If the user wants to transfer DOT but pay fees with USDC, assetId would be "DOT" and feeAssetId would be "1984"

  Respond with a JSON markdown block containing only the extracted values.`;

/**
 * Builds and validates a subsidized transfer object using the provided runtime, message, and state.
 */
export async function buildSubsidizedTransferDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
): Promise<SubsidizedTransferContent> {
    // Compose the current state (or create one based on the message)
    const currentState = state || (await runtime.composeState(message));

    // Compose a context to drive the object generation
    const prompt = composePromptFromState({
        state: currentState,
        template: subsidizedTransferTemplate,
    });

    // Generate an object using the defined schema
    let parsedResponse: SubsidizedTransferContent | null = null;
    for (let i = 0; i < 5; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });
        parsedResponse = parseJSONObjectFromText(response) as SubsidizedTransferContent | null;
        if (parsedResponse) {
            break;
        }
    }

    // Zod validate the response
    const validatedResponse = subsidizedTransferSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
        throw new Error('Failed to extract valid subsidized transfer details from the message');
    }

    return validatedResponse.data as SubsidizedTransferContent;
}

export class SubsidizedTransferAction {
    private runtime: IAgentRuntime;
    private walletProvider: WalletProvider;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    async initialize(): Promise<void> {
        this.walletProvider = await initWalletProvider(this.runtime);
    }

    async subsidizedTransfer(params: {
        recipientAddress: string;
        assetId: string;
        amount: string;
        feeAssetId: string;
        walletNumber?: number;
        walletAddress?: string;
        password?: string;
        dryRun?: boolean;
    }): Promise<{
        status: string;
        txHash: string;
        message: string;
    }> {
        // Load the appropriate wallet
        let targetWallet: WalletProvider;
        if (params.walletNumber) {
            targetWallet = await WalletProvider.loadWalletByNumber(
                this.walletProvider,
                params.walletNumber,
                params.password,
            );
        } else if (params.walletAddress) {
            targetWallet = await WalletProvider.loadWalletByAddress(
                this.walletProvider,
                params.walletAddress,
                params.password,
            );
        } else {
            targetWallet = this.walletProvider;
        }

        // Get the keypair from the wallet
        const keypair = targetWallet.keyring.getPairs()[0];
        if (!keypair) {
            throw new Error('No keypair found in the wallet');
        }

        // Connect to Asset Hub
        const api = await PolkadotApiService.getAssetHubConnection(this.runtime);
        elizaLogger.debug('Asset Hub API connection established');
        // Get asset metadata for proper decimal handling
        const assetMetadata = await getAssetMetadata(api, params.assetId);
        const feeAssetMetadata = await getAssetMetadata(api, params.feeAssetId);

        // Convert amount to the smallest unit based on asset decimals
        const amount = await toBaseUnits(api, params.assetId, params.amount);

        // Create the transfer extrinsic
        let transfer: ReturnType<
            typeof api.tx.balances.transferKeepAlive | typeof api.tx.assets.transfer
        >;
        if (params.assetId === 'DOT') {
            // Transfer native DOT on Asset Hub
            transfer = api.tx.balances.transferKeepAlive({ Id: params.recipientAddress }, amount);
        } else {
            // Transfer custom asset
            transfer = api.tx.assets.transfer(
                params.assetId,
                { Id: params.recipientAddress },
                amount,
            );
        }

        // Create fee asset location
        const feeAssetLocation = {
            parents: 0,
            interior: {
                X2: [
                    { palletInstance: 50 }, // Assets pallet
                    { generalIndex: parseInt(params.feeAssetId) }, // Fee asset ID
                ],
            },
        };

        if (params.dryRun) {
            elizaLogger.debug(
                `DRY RUN: Subsidized transfer of ${params.amount} ${assetMetadata.symbol} to ${params.recipientAddress} with fees paid in ${feeAssetMetadata.symbol} would be initiated.`,
            );

            return {
                status: 'success',
                txHash: '0xDRY_RUN_SIMULATION',
                message: `DRY RUN: Subsidized transfer of ${params.amount} ${assetMetadata.symbol} to ${params.recipientAddress} with fees paid in ${feeAssetMetadata.symbol} would be initiated.`,
            };
        }

        // Sign and send the transaction with asset-based fee payment
        const hash = await new Promise<string>((resolve, reject) => {
            transfer.signAndSend(
                keypair,
                {
                    assetId: feeAssetLocation,
                    tip: 0,
                },
                (result) => {
                    if (result.status.isInBlock) {
                        elizaLogger.debug(
                            `Transaction included in block: ${result.status.asInBlock}`,
                        );

                        // Look for AssetTxFeePaid events
                        for (const { event } of result.events) {
                            if (api.events.assetTxPayment?.AssetTxFeePaid?.is(event)) {
                                elizaLogger.debug('Fee paid with asset:', event.data.toHuman());
                            }
                        }

                        resolve(result.txHash.toHex());
                    } else if (result.status.isFinalized) {
                        resolve(result.txHash.toHex());
                    } else if (result.isError) {
                        reject(new Error('Transaction failed'));
                    }
                },
            );
        });

        elizaLogger.debug(
            `Subsidized transfer of ${params.amount} ${assetMetadata.symbol} to ${params.recipientAddress} with fees paid in ${feeAssetMetadata.symbol} completed. Transaction hash: ${hash}`,
        );

        return {
            status: 'success',
            txHash: hash,
            message: `Subsidized transfer of ${params.amount} ${assetMetadata.symbol} to ${params.recipientAddress} with fees paid in ${feeAssetMetadata.symbol} completed. Transaction hash: ${hash}`,
        };
    }
}

export default {
    name: 'POLKADOT_SUBSIDIZED_TRANSFER',
    similes: [
        'SUBSIDIZED_TRANSFER',
        'TRANSFER_WITH_FEE_ASSET',
        'ASSET_HUB_TRANSFER',
        'PAY_FEES_WITH_ASSET',
        'USDC_FEE_TRANSFER',
    ],
    description:
        'Transfers assets on Asset Hub while paying transaction fees with a different sufficient asset (e.g., pay fees with USDC instead of DOT).',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback,
    ) => {
        elizaLogger.log('Starting POLKADOT_SUBSIDIZED_TRANSFER action...');

        // Build transfer details using the object building approach
        const transferContent = await buildSubsidizedTransferDetails(runtime, message, state);

        elizaLogger.debug('subsidized transfer content:', transferContent);

        if (
            !transferContent ||
            !transferContent.recipientAddress ||
            !transferContent.assetId ||
            !transferContent.amount ||
            !transferContent.feeAssetId
        ) {
            elizaLogger.error('Failed to obtain required subsidized transfer details.');
            if (callback) {
                callback({
                    text: 'Unable to process subsidized transfer request. Could not obtain required details (recipient, asset, amount, or fee asset).',
                    content: {
                        error: 'Invalid subsidized transfer request. Required details could not be determined.',
                    },
                });
            }
            return false;
        }

        try {
            // Initialize the transfer action
            const action = new SubsidizedTransferAction(runtime);
            await action.initialize();

            // Execute the subsidized transfer
            const result = await action.subsidizedTransfer({
                recipientAddress: transferContent.recipientAddress,
                assetId: transferContent.assetId,
                amount: transferContent.amount,
                feeAssetId: transferContent.feeAssetId,
                walletNumber: transferContent.walletNumber,
                walletAddress: transferContent.walletAddress,
                password: transferContent.password,
            });

            if (callback) {
                callback({
                    text: result.message,
                    content: result,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Error executing subsidized transfer:', error);
            if (callback) {
                callback({
                    text: `Error executing subsidized transfer: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    validate: async (_runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Transfer 100 USDC to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty and pay fees with USDT',
                    action: 'POLKADOT_SUBSIDIZED_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Subsidized transfer of 100 USDC to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty with fees paid in USDT completed. Transaction hash: 0x...',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Send 1 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty using USDC for fees',
                    action: 'POLKADOT_SUBSIDIZED_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Subsidized transfer of 1 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty with fees paid in USDC completed. Transaction hash: 0x...',
                },
            },
        ],
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Transfer 50 USDT to Alice, pay transaction fees with USDC from wallet 2',
                    action: 'POLKADOT_SUBSIDIZED_TRANSFER',
                },
            },
            {
                name: '{{user2}}',
                content: {
                    text: 'Subsidized transfer of 50 USDT to Alice with fees paid in USDC from wallet 2 completed. Transaction hash: 0x...',
                },
            },
        ],
    ],
};
