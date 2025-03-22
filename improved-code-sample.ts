/**
 * Copyright (c) Whales Corp. 
 * All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, internal, MessageRelaxed, Sender, SendMode } from "ton-core";
import { Maybe } from "../utils/maybe";
import { createWalletTransferV4 } from "./signing/createWalletTransfer";

/**
 * Implementation of TON wallet contract version 4
 * @implements {Contract}
 */
export class WalletContractV4 implements Contract {

    /**
     * Create a new wallet contract instance
     * @param {Object} args - Constructor arguments
     * @param {number} args.workchain - Workchain ID
     * @param {Buffer} args.publicKey - Public key for the wallet
     * @param {Maybe<number>} [args.walletId] - Optional wallet ID
     * @returns {WalletContractV4} New wallet contract instance
     */
    static create(args: { workchain: number, publicKey: Buffer, walletId?: Maybe<number> }): WalletContractV4 {
        return new WalletContractV4(args.workchain, args.publicKey, args.walletId);
    }

    readonly workchain: number;
    readonly publicKey: Buffer;
    readonly address: Address;
    readonly walletId: number;
    readonly init: { data: Cell, code: Cell };

    /**
     * Internal wallet code in base64 format
     * @private
     */
    private static readonly WALLET_CODE_BASE64 = 'te6ccgECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVA==';

    /**
     * Create a new wallet contract instance
     * @param {number} workchain - Workchain ID
     * @param {Buffer} publicKey - Public key for the wallet
     * @param {Maybe<number>} [walletId] - Optional wallet ID
     */
    private constructor(workchain: number, publicKey: Buffer, walletId?: Maybe<number>) {
        // Validate inputs
        if (workchain < -1 || workchain > 0) {
            throw new Error("Invalid workchain ID: must be -1 or 0");
        }
        
        if (!publicKey || publicKey.length !== 32) {
            throw new Error("Invalid public key: must be 32 bytes");
        }

        // Resolve parameters
        this.workchain = workchain;
        this.publicKey = publicKey;
        this.walletId = walletId ?? (698983191 + workchain);

        // Build initial code and data
        const code = this.buildCode();
        const data = this.buildData();
        
        this.init = { code, data };
        this.address = contractAddress(workchain, { code, data });
    }

    /**
     * Build the contract code cell
     * @private
     * @returns {Cell} Code cell
     */
    private buildCode(): Cell {
        try {
            return Cell.fromBoc(Buffer.from(WalletContractV4.WALLET_CODE_BASE64, 'base64'))[0];
        } catch (error) {
            throw new Error(`Failed to build code cell: ${error.message}`);
        }
    }

    /**
     * Build the contract data cell
     * @private
     * @returns {Cell} Data cell
     */
    private buildData(): Cell {
        try {
            return beginCell()
                .storeUint(0, 32) // Seqno
                .storeUint(this.walletId, 32)
                .storeBuffer(this.publicKey)
                .storeBit(0) // Empty plugins dict
                .endCell();
        } catch (error) {
            throw new Error(`Failed to build data cell: ${error.message}`);
        }
    }

    /**
     * Get Wallet Balance
     * @param {ContractProvider} provider - Contract provider
     * @returns {Promise<bigint>} Wallet balance
     */
    async getBalance(provider: ContractProvider): Promise<bigint> {
        try {
            const state = await provider.getState();
            return state.balance;
        } catch (error) {
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    /**
     * Get Wallet Sequence Number
     * @param {ContractProvider} provider - Contract provider
     * @returns {Promise<number>} Current sequence number (0 for uninitiated contracts)
     */
    async getSeqno(provider: ContractProvider): Promise<number> {
        try {
            const state = await provider.getState();
            if (state.state.type === 'active') {
                const res = await provider.get('seqno', []);
                return res.stack.readNumber();
            } else {
                return 0;
            }
        } catch (error) {
            throw new Error(`Failed to get seqno: ${error.message}`);
        }
    }

    /**
     * Send signed transfer
     * @param {ContractProvider} provider - Contract provider
     * @param {Cell} message - Signed message cell
     * @returns {Promise<void>}
     */
    async send(provider: ContractProvider, message: Cell): Promise<void> {
        try {
            await provider.external(message);
        } catch (error) {
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    /**
     * Sign and send transfer
     * @param {ContractProvider} provider - Contract provider
     * @param {Object} args - Transfer arguments
     * @param {number} args.seqno - Current sequence number
     * @param {Buffer} args.secretKey - Private key for signing
     * @param {MessageRelaxed[]} args.messages - Messages to send
     * @param {Maybe<SendMode>} [args.sendMode] - Send mode
     * @param {Maybe<number>} [args.timeout] - Message timeout
     * @returns {Promise<void>}
     */
    async sendTransfer(provider: ContractProvider, args: {
        seqno: number,
        secretKey: Buffer,
        messages: MessageRelaxed[],
        sendMode?: Maybe<SendMode>,
        timeout?: Maybe<number>,
    }): Promise<void> {
        try {
            const transfer = this.createTransfer(args);
            await this.send(provider, transfer);
        } catch (error) {
            throw new Error(`Failed to send transfer: ${error.message}`);
        }
    }

    /**
     * Create signed transfer
     * @param {Object} args - Transfer arguments
     * @param {number} args.seqno - Current sequence number
     * @param {Buffer} args.secretKey - Private key for signing
     * @param {MessageRelaxed[]} args.messages - Messages to send
     * @param {Maybe<SendMode>} [args.sendMode] - Send mode
     * @param {Maybe<number>} [args.timeout] - Message timeout
     * @returns {Cell} Signed message cell
     */
    createTransfer(args: {
        seqno: number,
        secretKey: Buffer,
        messages: MessageRelaxed[],
        sendMode?: Maybe<SendMode>,
        timeout?: Maybe<number>,
    }): Cell {
        // Validate inputs
        if (!args.secretKey || args.secretKey.length !== 64) {
            throw new Error("Invalid secret key: must be 64 bytes");
        }
        
        if (!args.messages || args.messages.length === 0) {
            throw new Error("No messages to send");
        }

        const sendMode = args.sendMode ?? SendMode.PAY_GAS_SEPARATELY;
        
        return createWalletTransferV4({
            seqno: args.seqno,
            sendMode,
            secretKey: args.secretKey,
            messages: args.messages,
            timeout: args.timeout,
            walletId: this.walletId
        });
    }

    /**
     * Create a sender for convenience
     * @param {ContractProvider} provider - Contract provider
     * @param {Buffer} secretKey - Private key for signing
     * @returns {Sender} Sender interface implementation
     */
    sender(provider: ContractProvider, secretKey: Buffer): Sender {
        if (!secretKey || secretKey.length !== 64) {
            throw new Error("Invalid secret key: must be 64 bytes");
        }
        
        return {
            send: async (args) => {
                try {
                    const seqno = await this.getSeqno(provider);
                    const transfer = this.createTransfer({
                        seqno,
                        secretKey,
                        sendMode: args.sendMode,
                        messages: [internal({
                            to: args.to,
                            value: args.value,
                            init: args.init,
                            body: args.body,
                            bounce: args.bounce ?? true
                        })]
                    });
                    await this.send(provider, transfer);
                } catch (error) {
                    throw new Error(`Sender error: ${error.message}`);
                }
            }
        };
    }
}