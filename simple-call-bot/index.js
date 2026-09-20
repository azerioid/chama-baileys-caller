import { VoipClient } from "chama-baileys-caller";
import { printChamaBanner } from "chama-baileys-caller/lib/Caller/banner.js";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// 1. Path to your audio file (MP3 or WAV)
const AUDIO_FILE = resolve("./audio/welcome.mp3");

// 2. Auth directory for session persistence
const AUTH_DIR = resolve("./auth");
if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });

// 3. Optional: Set your phone number in environment variable PHONE_NUMBER (e.g. 94703229057)
// When set, the bot requests an 8-digit Pairing Code in console logs (ideal for headless cloud hosting like Render/Railway/VPS)!
// When empty, it prints the QR Code in the terminal to scan!
const PHONE_NUMBER = process.env.PHONE_NUMBER || "";

console.log("🚀 Starting Chama WhatsApp Call Bot Base...");

const client = new VoipClient({
  authDir: AUTH_DIR,
  autoAnswer: true,
  defaultAudioSource: AUDIO_FILE,
  defaultDurationMs: 60000,
  printQrInTerminal: !PHONE_NUMBER,
});

client.on("qr", (qr) => {
  if (PHONE_NUMBER) {
    console.log("[Bot] Pairing mode active. Requesting pairing code for +" + PHONE_NUMBER + "...");
  } else {
    console.log("\n📱 Scan the QR code above with WhatsApp to link your bot.");
  }
});

client.on("ready", async () => {
  const me = client.sock?.user?.id?.split(":")[0] || "Connected";
  printChamaBanner(me);
  console.log(`✅ [Bot] WhatsApp connected! Active number: +${me}`);
  console.log(`📞 [Bot] Auto-Answer is ACTIVE.`);
  console.log(`🎵 [Bot] Playing: ${AUDIO_FILE}`);
  console.log(`⏱️ [Bot] Auto-hangup: Call will cut immediately when voice audio finishes!`);
});

client.on("call", (call) => {
  const caller = call.peerJid.split("@")[0].split(":")[0];
  console.log(`\n📞 [Bot] Incoming call from +${caller} (ID: ${call.callId})`);
  console.log(`🎙️ [Bot] Auto-answering and streaming audio...`);

  call.on("connected", () => {
    console.log(`🎙️ [Bot] Call connected with +${caller}! Voice playing...`);
  });

  call.on("ended", (reason) => {
    console.log(`📴 [Bot] Call with +${caller} ended (${reason}). Ready for next call!`);
  });
});

await client.connect();

// Request Pairing Code if PHONE_NUMBER is provided and session is not yet registered
if (PHONE_NUMBER && !client.sock?.authState?.creds?.registered) {
  setTimeout(async () => {
    try {
      const cleanNumber = PHONE_NUMBER.replace(/\D/g, "");
      const code = await client.sock.requestPairingCode(cleanNumber);
      console.log(`\n======================================================`);
      console.log(`🔑 YOUR WHATSAPP PAIRING CODE: [ ${code} ]`);
      console.log(`Enter this code in WhatsApp -> Linked Devices -> Link with phone number`);
      console.log(`======================================================\n`);
    } catch (err) {
      console.error("❌ Failed to request pairing code:", err.message);
    }
  }, 3000);
}
