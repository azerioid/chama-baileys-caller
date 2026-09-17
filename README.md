# chama-baileys-caller 📞⚡

> WhatsApp Web VoIP Calling & Auto-Answer Engine powered by Baileys, WebAssembly, and FFmpeg.  
> **Author:** Chama

---

## ✨ Features

- ✅ **WhatsApp Voice Call Auto-Answer (`acceptCall`)**
- ✅ **Custom Voice Streaming (MP3/WAV to Live Call)** via FFmpeg & Opus
- ✅ **Auto-Hangup** after voice audio completes playback
- ✅ **Outbound 1:1 Voice Calls** (`client.call()`)
- ✅ **Event Emitter API** (`client.on('call')`, `call.on('connected')`, etc.)
- ✅ **MongoDB Session Persistence Support** for 24/7 bots
- ✅ **Multi-Device Multi-File Auth Support**
- ✅ **React Web Dashboard & Node.js API Ready**

---

## 📋 System Requirements

- **Node.js** ≥ 20.0.0
- **FFmpeg** installed and added to `PATH`
- WhatsApp account for QR code pairing

---

## 🚀 Quick Start (CLI Bot)

### 1. Install Dependencies & Build
```bash
npm install
npm run build
```

### 2. Run the Auto-Answer Bot
```bash
npm run start:bot
```
1. A QR code will be generated in your terminal.
2. Open WhatsApp on your phone > **Settings** > **Linked Devices** > **Link a Device**.
3. Scan the QR code.
4. When someone calls this WhatsApp number, the bot **answers automatically**, **plays your audio file**, and **hangs up** when the audio finishes!

---

## 💻 API Usage

```typescript
import { VoipClient } from "chama-baileys-caller";

const client = new VoipClient({
  authDir: "./auth",
  autoAnswer: true,                       // Automatically answer incoming calls
  defaultAudioSource: "./audio/voice.mp3", // Path to voice file
  defaultDurationMs: 30000                // Max duration fallback
});

// Real-time events
client.on("qr", (qr) => console.log("QR Ready:", qr));
client.on("ready", () => console.log("Bot Connected!"));

// Incoming Call event
client.on("call", (call) => {
  console.log("Call from:", call.peerJid);

  call.on("connected", () => {
    console.log("Audio streaming started!");
  });

  call.on("ended", (reason) => {
    console.log("Call finished:", reason);
  });
});

await client.connect();
```

---

## ⚙️ Architecture

```
Incoming Call (WhatsApp Server) 
     │
     ▼ (Signaling: CB:call with <offer>)
Baileys Socket 
     │
     ▼ (Decrypted signaling offer)
WhatsApp Web VoIP WASM Engine (in-process)
     │
     ▼
VoipClient auto-answer hook ──► acceptCall(isMicEnabled: true)
     │
     ▼
AudioFeeder (FFmpeg) streams MP3/WAV ──► Opus Uplink ──► Caller hears Voice!
     │
     ▼
Playback finished ──► endCall() hangs up
```

---

## 📄 License
MIT © Chama
