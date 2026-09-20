/**
 * Chama Baileys Caller — Voice Call Auto-Answer Plugin
 * 
 * Gives ANY Baileys bot instant WhatsApp VoIP voice call answering & audio playback!
 * 
 * @author Chama (@chamanemax02)
 */

import { printChamaBanner } from "./banner.js";
import { VoipClient, CallState } from "./index.mjs";

let _activeVoipClient = null;

/**
 * Enable WhatsApp Voice Call Auto-Answer with audio playback on any Baileys socket.
 * 
 * @param {any} sock The Baileys socket created by makeWASocket()
 * @param {object} options Call configuration options
 * @param {string} [options.audio="welcome.wav"] Path to MP3 / WAV audio to play
 * @param {boolean} [options.autoAnswer=true] Automatically answer incoming calls
 * @param {number} [options.answerDelayMs=200] Delay before answering in milliseconds
 * @param {number} [options.durationMs=60000] Maximum call duration in milliseconds
 * @param {function} [options.onCall] Callback when an incoming call arrives
 * @param {function} [options.onAnswer] Callback when call is answered
 * @param {function} [options.onEnd] Callback when call ends
 * @returns {Promise<VoipClient>}
 */
export async function enableCallAutoAnswer(sock, options = {}) {
  printChamaBanner();

  const autoAnswer = options.autoAnswer !== false;
  const audioSource = options.audio || options.audioSource || options.audioFile || "welcome.wav";
  const durationMs = options.durationMs || 60000;
  const answerDelay = options.answerDelayMs || 200;

  console.log(`\x1b[38;5;82m📞 [Chama Caller] Voice Engine Active — Auto-Answer: ${autoAnswer ? "ON" : "OFF"} | Audio: ${audioSource}\x1b[0m`);

  const client = new VoipClient({
    autoAnswer: false,
    defaultAudioSource: audioSource,
    defaultDurationMs: durationMs,
  });

  await client.attach(sock);
  _activeVoipClient = client;

  client.on("call", (call) => {
    const callerNumber = call.peerJid ? call.peerJid.split("@")[0].split(":")[0] : "Unknown";
    console.log(`\n\x1b[38;5;213m📞 [Chama Caller] Incoming WhatsApp call from +${callerNumber} (ID: ${call.callId})\x1b[0m`);

    if (options.onCall) {
      try { options.onCall(call); } catch {}
    }

    if (autoAnswer) {
      setTimeout(() => {
        try {
          console.log(`\x1b[38;5;51m🎙️ [Chama Caller] Auto-answering call from +${callerNumber} with ${audioSource}...\x1b[0m`);
          call.accept(audioSource);
          if (options.onAnswer) {
            try { options.onAnswer(call); } catch {}
          }
        } catch (err) {
          console.error("❌ [Chama Caller] Error answering call:", err.message);
        }
      }, answerDelay);
    }

    call.on("connected", () => {
      console.log(`\x1b[38;5;82m🎙️ [Chama Caller] Call answered with +${callerNumber}! Streaming audio...\x1b[0m`);
    });

    call.on("ended", (reason) => {
      console.log(`\x1b[38;5;208m📴 [Chama Caller] Call with +${callerNumber} ended (${reason})\x1b[0m`);
      if (options.onEnd) {
        try { options.onEnd(call, reason); } catch {}
      }
    });
  });

  return client;
}

export function getActiveVoipClient() {
  return _activeVoipClient;
}

export { CallState };
