import { VoipClient } from "../dist/index.mjs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

console.log("====================================================");
console.log("   Chama WhatsApp VoIP Call Auto-Answer Bot         ");
console.log("====================================================");

const audioPath = resolve("./audio/welcome.wav");
if (!existsSync(audioPath)) {
  console.warn(`[Warning] Audio file not found at: ${audioPath}`);
} else {
  console.log(`[Config] Default voice audio: ${audioPath}`);
}

const client = new VoipClient({
  authDir: "./auth",
  autoAnswer: true,
  defaultAudioSource: audioPath,
  defaultDurationMs: 30_000,
});

client.on("qr", () => {
  console.log("[Bot] Scan the QR code above with your WhatsApp app (Linked Devices)");
});

client.on("ready", () => {
  console.log("✅ [Bot] WhatsApp connected successfully! Listening for calls...");
});

client.on("call", (call) => {
  console.log(`\n📞 [Call] Incoming call detected from: ${call.peerJid}`);
  console.log(`📞 [Call] Call ID: ${call.callId}`);

  call.on("connected", () => {
    console.log("🎙️ [Call] Call connected! Streaming voice audio to caller...");
  });

  call.on("ended", (reason) => {
    console.log(`📴 [Call] Call ended (${reason})`);
  });
});

// Start connecting
await client.connect();
