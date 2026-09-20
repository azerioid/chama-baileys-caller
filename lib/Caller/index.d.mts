/**
 * baileys-caller — WhatsApp voice calling for Node.js.
 *
 * Wraps WhatsApp Web's official VoIP WASM stack and routes signaling through
 * Baileys. Public surface:
 *
 *   const client = new VoipClient({ authDir })
 *   await client.connect()
 *   const call = await client.call("12345678901", { audioSource: "./hi.mp3" })
 *
 * @author ShellTear
 */
import { EventEmitter } from "node:events";
import { WasmEngine } from "./wasm-engine.mjs";
import { CallState, type VoipSdkConfig } from "./types.mjs";
export type { VoipSdkConfig, CallOptions, CallEvents, AudioConfig } from "./types.mjs";
export { CallState } from "./types.mjs";
/** A live or recently-ended call. */
export declare class ActiveCall extends EventEmitter {
    #private;
    readonly callId: string;
    private readonly engine;
    /** @internal mirrors the source path for the audio feeder */
    _audioSource: string;
    peerJid: string;
    isIncoming: boolean;
    /** @internal */
    _shouldAutoAccept: boolean;
    constructor(callId: string, engine: WasmEngine, durationMs: number);
    get state(): CallState;
    accept: (audioSource?: string) => void;
    reject: () => void;
    end: () => void;
    mute: (muted: boolean) => void;
    waitForEnd: () => Promise<string>;
    /** @internal — called by VoipClient on WASM call-state change */
    _updateState: (state: number) => void;
    /** @internal */
    _emitAudio: (pcm: Float32Array) => void;
    /** @internal */
    _forceEnd: (reason: string) => void;
}
/** Top-level client. Connects to WhatsApp and lets you place or answer calls. */
export declare class VoipClient extends EventEmitter {
    #private;
    constructor(config?: VoipSdkConfig);
    get sock(): any;
    get activeCall(): ActiveCall | null;
    get engine(): WasmEngine | null;
    /** Connect to WhatsApp and bring up the WASM VoIP stack. */
    connect: () => Promise<void>;
    /** Attach to an existing Baileys socket instead of creating a new one. */
    attach: (sock: any) => Promise<void>;
    /** Place an outbound voice call. */
    call: (phoneNumber: string, opts?: {
        audioSource?: string;
        durationMs?: number;
    }) => Promise<ActiveCall>;
    /** Accept an incoming call */
    acceptCall: (audioSource?: string) => void;
    /** Reject an incoming call */
    rejectCall: () => void;
    /** Tear down the WhatsApp socket and release resources. */
    disconnect: () => void;
    destroy: () => void;
}
