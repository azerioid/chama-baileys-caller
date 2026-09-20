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
import { randomBytes, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { WasmEngine } from "./wasm-engine.mjs";
import { RelayRtcTransport } from "./relay-transport.mjs";
import { SignalingBridge } from "./signaling.mjs";
import { AudioFeeder } from "./audio-feeder.mjs";
import { CallState } from "./types.mjs";
export { CallState } from "./types.mjs";
const SHA256_LEN = 32;
const loadBaileys = async () => {
    try {
        const rel = "../index.js";
        return await import(rel);
    }
    catch { }
    try {
        const rel2 = "./index.js";
        return await import(rel2);
    }
    catch { }
    try {
        return await import("@whiskeysockets/baileys");
    }
    catch {
        throw new Error("Could not load Baileys module. Make sure chama-baileys-caller or @whiskeysockets/baileys is available.");
    }
};
const toBareJid = (jid) => {
    if (!jid)
        return jid;
    const at = jid.indexOf("@");
    if (at < 0)
        return jid;
    const user = jid.slice(0, at).split(":")[0];
    return `${user}@${jid.slice(at + 1)}`;
};
const computeHkdf = (key, salt, info, length) => {
    const effectiveSalt = salt && salt.length > 0 ? Buffer.from(salt) : Buffer.alloc(SHA256_LEN, 0);
    const prk = createHmac("sha256", effectiveSalt).update(key).digest();
    const blocks = Math.ceil(length / SHA256_LEN);
    const okm = Buffer.alloc(blocks * SHA256_LEN);
    let prev = Buffer.alloc(0);
    for (let i = 1; i <= blocks; i += 1) {
        prev = createHmac("sha256", prk)
            .update(prev)
            .update(info)
            .update(Buffer.from([i]))
            .digest();
        prev.copy(okm, (i - 1) * SHA256_LEN);
    }
    return new Uint8Array(okm.buffer, okm.byteOffset, length);
};
const computeHmacSha256 = (data, key) => {
    const result = createHmac("sha256", Buffer.from(key)).update(data).digest();
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
};
const isCallReceiptNode = (node) => {
    if (node?.tag !== "receipt")
        return false;
    const child = Array.isArray(node.content) ? node.content[0] : null;
    return !!(child?.attrs?.["call-id"] || child?.attrs?.call_id);
};
/** A live or recently-ended call. */
export class ActiveCall extends EventEmitter {
    callId;
    engine;
    #state = CallState.Idle;
    #endResolver;
    #endPromise;
    #endTimer = null;
    #ended = false;
    /** @internal mirrors the source path for the audio feeder */
    _audioSource = "silence";
    peerJid = "";
    isIncoming = false;
    #accepted = false;
    constructor(callId, engine, durationMs) {
        super();
        this.callId = callId;
        this.engine = engine;
        this.#endPromise = new Promise((res) => { this.#endResolver = res; });
        if (durationMs > 0) {
            this.#endTimer = setTimeout(() => this.end(), durationMs);
        }
    }
    get state() { return this.#state; }
    accept = (audioSource) => {
        if (this.#ended || this.#accepted)
            return;
        this.#accepted = true;
        if (audioSource)
            this._audioSource = audioSource;
        try {
            this.engine.acceptCall(true, false);
        }
        catch { }
    };
    reject = () => {
        if (this.#ended)
            return;
        try {
            this.engine.rejectCall();
        }
        catch { }
        this.end();
    };
    end = () => {
        if (this.#ended)
            return;
        this.#ended = true;
        if (this.#endTimer) {
            clearTimeout(this.#endTimer);
            this.#endTimer = null;
        }
        try {
            this.engine.endCall(0, true);
        }
        catch { }
        this._forceEnd("ended");
    };
    mute = (muted) => {
        try {
            this.engine.setMute(muted);
        }
        catch { }
    };
    waitForEnd = () => this.#endPromise;
    /** @internal — called by VoipClient on WASM call-state change */
    _updateState = (state) => {
        this.#state = state;
        if (state === CallState.PreacceptReceived)
            this.emit("ringing");
        else if (state === CallState.Active)
            this.emit("connected");
        else if (state === CallState.Idle || state === CallState.Ending) {
            this._forceEnd("ended");
        }
    };
    /** @internal */
    _emitAudio = (pcm) => { this.emit("audio", pcm); };
    /** @internal */
    _forceEnd = (reason) => {
        if (this.#ended)
            return;
        this.#ended = true;
        if (this.#endTimer) {
            clearTimeout(this.#endTimer);
            this.#endTimer = null;
        }
        this.emit("ended", reason);
        this.#endResolver(reason);
    };
}
/** Top-level client. Connects to WhatsApp and lets you place or answer calls. */
export class VoipClient extends EventEmitter {
    #config;
    #engine = null;
    #relay = null;
    #signaling = null;
    #sock = null;
    #activeCall = null;
    #baileys = null;
    // Capture state populated when WASM negotiates audio params
    #capturePtr = 0;
    #captureChunkBytes = 0;
    #captureSampleRate = 16000;
    #captureChannels = 1;
    #captureFramesPerChunk = 320;
    #feeder = null;
    constructor(config = {}) {
        super();
        this.#config = config;
    }
    get sock() { return this.#sock; }
    get activeCall() { return this.#activeCall; }
    get engine() { return this.#engine; }
    /** Connect to WhatsApp and bring up the WASM VoIP stack. */
    connect = async () => {
        this.#baileys = await loadBaileys();
        const { useMultiFileAuthState, default: makeWASocket, DisconnectReason } = this.#baileys;
        const makeSocket = makeWASocket ?? this.#baileys.makeWASocket ?? this.#baileys;
        let state;
        let saveCreds;
        if (this.#config.authState) {
            state = this.#config.authState.state;
            saveCreds = this.#config.authState.saveCreds;
        }
        else {
            const authDir = resolve(this.#config.authDir || "./auth");
            const authResult = await useMultiFileAuthState(authDir);
            state = authResult.state;
            saveCreds = authResult.saveCreds;
        }
        const silentLogger = {
            level: "silent",
            child: () => silentLogger,
            trace: () => { },
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
            fatal: () => { },
        };
        const createSocket = () => makeSocket({
            auth: state,
            emitOwnEvents: true,
            logger: silentLogger,
        });
        // Connect with auto-reconnect on the post-QR 515 stream-error path.
        await new Promise((resolveOpen, rejectOpen) => {
            let opened = false;
            let retries = 0;
            const maxRetries = 5;
            const connectSocket = () => {
                this.#sock = createSocket();
                this.#sock.ev.on("creds.update", saveCreds);
                process.removeAllListeners("uncaughtException");
                process.on("uncaughtException", (err) => {
                    const code = err?.output?.statusCode ?? err?.data?.attrs?.code;
                    if ((code === 515 || code === "515") && !opened && retries < maxRetries) {
                        retries += 1;
                        setTimeout(connectSocket, 1500);
                    }
                    else if (!opened) {
                        rejectOpen(err);
                    }
                });
                this.#sock.ev.on("connection.update", (update) => {
                    this.emit("connection.update", update);
                    if (update.qr) {
                        this.emit("qr", update.qr);
                    }
                    if (update.connection === "open") {
                        opened = true;
                        process.removeAllListeners("uncaughtException");
                        this.emit("ready");
                        resolveOpen();
                        return;
                    }
                    if (update.connection === "close" && !opened) {
                        const err = update.lastDisconnect?.error;
                        const statusCode = err?.output?.statusCode ?? err?.data?.attrs?.code;
                        const msg = err?.message || "";
                        const isLoggedOut = statusCode === DisconnectReason?.loggedOut;
                        if (!isLoggedOut) {
                            retries += 1;
                            setTimeout(connectSocket, 1500);
                        }
                        else {
                            rejectOpen(err ?? new Error("socket closed before open"));
                        }
                    }
                });
            };
            connectSocket();
        });
        await this.#initVoipOnSocket();
    };
    /** Attach to an existing Baileys socket instead of creating a new one. */
    attach = async (sock) => {
        this.#baileys = await loadBaileys();
        this.#sock = sock;
        if (this.#sock.authState?.creds?.me?.id && this.#sock.ws?.isOpen) {
            await this.#initVoipOnSocket();
        }
        else {
            await new Promise((resolve) => {
                const handler = async (update) => {
                    if (update.connection === "open") {
                        this.#sock.ev.off("connection.update", handler);
                        await this.#initVoipOnSocket();
                        resolve();
                    }
                };
                this.#sock.ev.on("connection.update", handler);
            });
        }
    };
    #initVoipOnSocket = async () => {
        this.#signaling = new SignalingBridge({ sock: this.#sock });
        await this.#signaling.init();
        this.#relay = new RelayRtcTransport({
            onTransportMessage: (data, ip, port) => this.#engine?.handleOnTransportMessage(data, ip, port),
            onIceRtt: (rttMs, ip, port) => this.#engine?.updateIceRtt(rttMs, ip, port),
        });
        this.#engine = new WasmEngine({
            callbacks: {
                onSignalingXmpp: (peerJid, callId, xmlPayload) => this.#signaling.sendSignaling(peerJid, callId, xmlPayload),
                onCallEvent: (eventType, eventData) => this.#handleCallEvent(eventType, eventData),
                sendDataToRelay: (data, ip, port) => this.#relay.send(data, ip, port),
                onAudioCaptureInit: (config) => this.#handleAudioCaptureInit(config),
                onAudioCaptureStart: () => this.#handleAudioCaptureStart(),
                onAudioCaptureStop: () => this.#handleAudioCaptureStop(),
                onAudioPlaybackData: (audioData) => this.#activeCall?._emitAudio(audioData),
                cryptoHkdf: computeHkdf,
                hmacSha256: computeHmacSha256,
            },
        });
        await this.#engine.initialize();
        this.#signaling.attachEngine(this.#engine);
        const selfPnJid = this.#sock.authState.creds.me?.id;
        const selfLidJid = this.#sock.authState.creds.me?.lid;
        this.#engine.initVoipStack(selfPnJid, toBareJid(selfPnJid), selfLidJid);
        await this.#engine.waitForVoipStackReady();
        try {
            this.#engine.updateNetworkMedium(2, 0);
        }
        catch { }
        this.#sock.ws?.on?.("CB:call", (node) => {
            console.log(`\n🔔 [VoipClient] Received CB:call stanza! Node tag: ${node?.tag}`);
            this.#signaling.processIncomingCall(node, this.#engine, this.#activeCall?.callId ?? "");
            this.#checkIncomingCallOffer(node);
            this.#checkIncomingCallTerminate(node);
        });
        this.#sock.ws?.on?.("CB:receipt", (node) => {
            if (!isCallReceiptNode(node))
                return;
            this.#signaling.processIncomingReceipt(node, this.#engine, this.#activeCall?.callId ?? "");
        });
        this.#sock.ev?.on?.("call", (calls) => {
            console.log(`\n🔔 [Baileys EV] Received call event on socket.ev:`, JSON.stringify(calls));
        });
    };
    /** Place an outbound voice call. */
    call = async (phoneNumber, opts = {}) => {
        if (!this.#engine || !this.#signaling)
            throw new Error("Not connected. Call connect() first.");
        if (this.#activeCall)
            throw new Error("A call is already active.");
        const targetNumber = phoneNumber.replace(/\D/g, "");
        const targetPnJid = `${targetNumber}@s.whatsapp.net`;
        const durationMs = opts.durationMs ?? 120_000;
        const audioSource = opts.audioSource ?? "silence";
        const peerLid = await this.#signaling.resolveLid(targetPnJid);
        if (!peerLid)
            throw new Error(`Could not resolve LID for ${targetPnJid}`);
        for (const jid of [targetPnJid, peerLid]) {
            try {
                await this.#sock.presenceSubscribe(jid);
            }
            catch { }
        }
        await new Promise((r) => setTimeout(r, 750));
        const peerDeviceJids = await this.#signaling.discoverPeerDevices(peerLid);
        const deviceList = peerDeviceJids.length ? peerDeviceJids : [toBareJid(peerLid)];
        await this.#signaling.ensureSessionsForPeers(deviceList);
        await new Promise((r) => setTimeout(r, 500));
        await this.#signaling.issueTcToken(peerLid);
        const tcToken = await this.#signaling.ensureTcToken(peerLid, targetPnJid);
        const callId = ("00" + randomBytes(16).toString("hex").slice(2)).toUpperCase();
        const call = new ActiveCall(callId, this.#engine, durationMs);
        call._audioSource = audioSource;
        this.#activeCall = call;
        this.#engine.startCall({
            peerJid: peerLid,
            peerPn: targetPnJid,
            peerList: deviceList,
            callId,
            isVideo: false,
            isLidCall: true,
            isFromDialer: false,
            extraData: tcToken,
        });
        return call;
    };
    /** Accept an incoming call */
    acceptCall = (audioSource) => {
        if (!this.#engine)
            throw new Error("Not connected. Call connect() first.");
        if (this.#activeCall) {
            this.#activeCall.accept(audioSource);
            return;
        }
        this.#engine.acceptCall(true, false);
    };
    /** Reject an incoming call */
    rejectCall = () => {
        if (!this.#engine)
            throw new Error("Not connected. Call connect() first.");
        this.#engine.rejectCall();
        this.#activeCall?._forceEnd("rejected");
        this.#activeCall = null;
    };
    /** Tear down the WhatsApp socket and release resources. */
    disconnect = () => {
        this.#activeCall?._forceEnd("disconnect");
        this.#activeCall = null;
        this.#relay?.closeAll();
        this.#engine?.destroy();
        this.#sock?.end?.();
        this.#engine = null;
        this.#relay = null;
        this.#signaling = null;
        this.#sock = null;
    };
    // ─── private ──────────────────────────────────────────────────────────────
    #checkIncomingCallOffer = (node) => {
        try {
            const { getAllBinaryNodeChildren } = this.#baileys;
            const voipChild = getAllBinaryNodeChildren(node)[0];
            console.log(`📞 [VoipClient] checkIncomingCallOffer child tag: <${voipChild?.tag}>`);
            if (!voipChild || voipChild.tag !== "offer")
                return;
            const incomingCallId = String(voipChild.attrs["call-id"] ?? voipChild.attrs.call_id ?? "");
            const senderDeviceJid = String(voipChild.attrs.participant ?? "") ||
                String(node.attrs.participant ?? "") ||
                String(node.attrs.from ?? "") ||
                String(voipChild.attrs["call-creator"] ?? "");
            const callbackPeerJid = String(node.attrs.from ?? "") || senderDeviceJid;
            if (this.#activeCall && this.#activeCall.callId !== incomingCallId) {
                console.log(`[VoipClient] Cleaning up previous call ${this.#activeCall.callId} to receive new call ${incomingCallId}`);
                this.#activeCall._forceEnd("superseded");
                this.#activeCall = null;
                this.#handleAudioCaptureStop();
                try {
                    this.#engine?.endCall(0, false);
                }
                catch { }
                void this.#relay?.closeAll();
            }
            const call = new ActiveCall(incomingCallId, this.#engine, this.#config.defaultDurationMs ?? 60_000);
            call.peerJid = callbackPeerJid || senderDeviceJid;
            call.isIncoming = true;
            call._audioSource = this.#config.defaultAudioSource ?? "silence";
            this.#activeCall = call;
            call.on("ended", () => {
                if (this.#activeCall === call) {
                    this.#activeCall = null;
                }
                this.#handleAudioCaptureStop();
                try {
                    this.#engine?.endCall(0, false);
                }
                catch { }
                void this.#relay?.closeAll();
            });
            this.emit("call", call);
            if (this.#config.autoAnswer) {
                setTimeout(() => {
                    try {
                        console.log(`[VoipClient] Auto-answering call from ${call.peerJid}...`);
                        this.acceptCall(call._audioSource);
                    }
                    catch (err) {
                        console.error("[VoipClient] Auto-answer error:", err);
                    }
                }, 1000);
            }
        }
        catch (err) {
            console.error("[VoipClient] Error inspecting incoming call:", err);
        }
    };
    #checkIncomingCallTerminate = (node) => {
        try {
            const { getAllBinaryNodeChildren } = this.#baileys;
            const voipChild = getAllBinaryNodeChildren(node)[0];
            if (voipChild && (voipChild.tag === "terminate" || voipChild.tag === "reject")) {
                console.log(`📴 [VoipClient] Remote peer terminated/rejected call (tag: <${voipChild.tag}>)`);
                if (this.#activeCall) {
                    this.#activeCall._forceEnd(voipChild.tag);
                    this.#activeCall = null;
                }
                this.#handleAudioCaptureStop();
                try {
                    this.#engine?.endCall(0, false);
                }
                catch { }
                void this.#relay?.closeAll();
            }
        }
        catch { }
    };
    #handleCallEvent = (eventType, eventData) => {
        console.log(`[VoipClient] WASM Event ${eventType}:`, eventData ? eventData.slice(0, 100) : "");
        if (eventType === 16 && eventData) {
            try {
                const parsed = JSON.parse(eventData);
                const info = parsed.call_info ?? parsed.callInfo ?? {};
                const callState = Number(info.call_state ?? info.callState ?? 0);
                console.log(`[VoipClient] WASM Call State transitioned to: ${callState}`);
                this.#activeCall?._updateState(callState);
                if (callState === 6) { // CallState.Active
                    console.log("[VoipClient] Call reached Active state (6). Starting audio streamer...");
                    this.#handleAudioCaptureStart();
                }
            }
            catch { }
        }
        else if (eventType === 156 && eventData) {
            try {
                const update = JSON.parse(eventData);
                console.log(`[VoipClient] WASM Relay List Update (${update.relays?.length || 0} relays available)`);
                this.#relay?.updateRelayList(update);
            }
            catch { }
        }
    };
    #ensureCaptureBuffer = () => {
        if (!this.#engine)
            return;
        if (!this.#capturePtr) {
            const chunkSamples = this.#captureFramesPerChunk * this.#captureChannels;
            this.#captureChunkBytes = chunkSamples * Float32Array.BYTES_PER_ELEMENT;
            this.#capturePtr = this.#engine.malloc(this.#captureChunkBytes);
            console.log(`[VoipClient] Allocated audio capture buffer: ptr=${this.#capturePtr}, bytes=${this.#captureChunkBytes} (${this.#captureSampleRate}Hz, ${this.#captureChannels}ch)`);
        }
    };
    #handleAudioCaptureInit = (config) => {
        if (!this.#engine)
            return;
        this.#captureSampleRate = config.sampleRate || 16000;
        this.#captureChannels = config.channels || 1;
        this.#captureFramesPerChunk = config.framesPerChunk || 320;
        this.#ensureCaptureBuffer();
    };
    #handleAudioCaptureStart = () => {
        if (!this.#engine)
            return;
        this.#ensureCaptureBuffer();
        if (!this.#capturePtr) {
            console.error("[VoipClient] Failed to allocate audio capture buffer!");
            return;
        }
        if (this.#feeder) {
            console.log("[VoipClient] Audio feeder is already active.");
            return;
        }
        const audioSource = this.#activeCall?._audioSource ?? this.#config.defaultAudioSource ?? "silence";
        console.log(`[VoipClient] Starting AudioFeeder with source: ${audioSource}`);
        this.#feeder = new AudioFeeder(this.#captureSampleRate, this.#captureChannels, this.#captureFramesPerChunk, (chunk) => {
            if (this.#engine && this.#capturePtr) {
                this.#engine.sendAudioData(chunk, this.#capturePtr);
            }
        }, audioSource, () => {
            console.log("[VoipClient] Audio playback completed. Auto hanging up call...");
            this.#activeCall?.end();
        }, false);
        this.#feeder.start();
    };
    #handleAudioCaptureStop = () => {
        console.log("[VoipClient] Stopping AudioFeeder...");
        this.#feeder?.stop();
        this.#feeder = null;
        if (this.#engine && this.#capturePtr) {
            try {
                this.#engine.free(this.#capturePtr);
            }
            catch { }
            this.#capturePtr = 0;
        }
    };
    destroy = () => {
        try {
            this.#feeder?.stop();
            this.#feeder = null;
            this.#activeCall?.end();
            this.#activeCall = null;
            void this.#relay?.closeAll();
            this.#relay = null;
            this.#engine?.destroy();
            this.#engine = null;
            this.#sock?.end(undefined);
            this.#sock = null;
        }
        catch { }
    };
}
