import _makeWASocket from './Socket/index.js';
import { UserFacingSocketConfig } from './Types/index.js';
import { enableCallAutoAnswer, getActiveVoipClient } from './Caller/auto-answer.js';
import { printChamaBanner } from './Caller/banner.js';

export * from '../WAProto/index.js';
export * from './Utils/index.js';
export * from './Types/index.js';
export * from './Defaults/index.js';
export * from './WABinary/index.js';
export * from './WAM/index.js';
export * from './WAUSync/index.js';
export { printChamaBanner, enableCallAutoAnswer, getActiveVoipClient };

export interface CallConfig {
    audio?: string;
    audioSource?: string;
    autoAnswer?: boolean;
    answerDelayMs?: number;
    durationMs?: number;
    onCall?: (call: any) => void;
    onAnswer?: (call: any) => void;
    onEnd?: (call: any, reason?: any) => void;
}

export type EnhancedSocketConfig = UserFacingSocketConfig & {
    callConfig?: CallConfig;
};

export type WASocket = ReturnType<typeof _makeWASocket> & {
    enableCallAutoAnswer: (opts?: CallConfig) => ReturnType<typeof enableCallAutoAnswer>;
};

declare const makeWASocket: (config?: EnhancedSocketConfig) => WASocket;

export { makeWASocket };
export default makeWASocket;