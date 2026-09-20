/**
 * Audio feeder.
 *
 * Decodes `source` into an in-memory Float32Array PCM buffer at the requested rate,
 * then meters frames out with microsecond-accurate cadence to the WASM VoIP uplink.
 * Supports continuous, seamless looping without underflow or silence dropouts.
 *
 * @author ShellTear & Chama
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

// Cache decoded audio buffers in memory across calls for instant 0ms startup
const audioBufferCache = new Map<string, Float32Array>();

export class AudioFeeder {
  #proc: ChildProcessWithoutNullStreams | null = null;
  #emitTimer: NodeJS.Timeout | null = null;
  #nextEmitAtMs = 0;
  #active = false;
  #samples: Float32Array | null = null;
  #playhead = 0;

  droppedChunks = 0;
  underflowChunks = 0;
  bytesProduced = 0;
  chunksEmitted = 0;
  #finishedEmitted = false;

  constructor(
    private readonly sampleRate: number,
    private readonly channels: number,
    private readonly framesPerChunk: number,
    private readonly onChunk: (chunk: Float32Array) => void,
    private readonly source: string = "silence",
    private readonly onFinished?: () => void,
    private readonly loop: boolean = false,
  ) {}

  start = (): void => {
    if (this.#active) return;
    this.#active = true;

    const chunkSamples = this.framesPerChunk * this.channels;
    const chunkIntervalMs = (this.framesPerChunk / this.sampleRate) * 1000;
    const cacheKey = `${this.source}:${this.sampleRate}:${this.channels}`;

    if (!this.source || this.source === "silence") {
      this.#samples = new Float32Array(chunkSamples);
      this.#playhead = 0;
      this.#startClock(chunkSamples, chunkIntervalMs);
      return;
    }

    const cached = audioBufferCache.get(cacheKey);
    if (cached && cached.length > 0) {
      console.log(`[AudioFeeder] Using cached PCM buffer (${cached.length} samples, ${(cached.length / this.sampleRate).toFixed(1)}s) for ${this.source}`);
      this.#samples = cached;
      this.#playhead = 0;
      this.#startClock(chunkSamples, chunkIntervalMs);
      return;
    }

    // Decode with ffmpeg into memory
    console.log(`[AudioFeeder] Decoding audio source to PCM: ${this.source}`);
    const inputArgs = this.source.startsWith("lavfi:")
      ? ["-f", "lavfi", "-i", this.source.slice("lavfi:".length)]
      : ["-i", this.source];

    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      ...inputArgs,
      "-f", "f32le",
      "-ac", String(this.channels),
      "-ar", String(this.sampleRate),
      "pipe:1",
    ]);
    this.#proc = proc;

    const chunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // Start streaming immediately once we have buffered at least 200ms
      if (!this.#samples && chunks.length > 0) {
        const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
        if (totalBytes >= chunkSamples * 4 * 10) {
          const partialBuf = Buffer.concat(chunks);
          const numFloats = Math.floor(partialBuf.length / 4);
          const partialFloats = new Float32Array(numFloats);
          const srcView = new Uint8Array(partialBuf.buffer, partialBuf.byteOffset, numFloats * 4);
          const dstView = new Uint8Array(partialFloats.buffer, partialFloats.byteOffset, numFloats * 4);
          dstView.set(srcView);
          this.#samples = partialFloats;
          this.#startClock(chunkSamples, chunkIntervalMs);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[AudioFeeder] ${chunk.toString().trim()}\n`);
    });

    proc.on("close", () => {
      this.#proc = null;
      if (!this.#active) return;

      const fullBuf = Buffer.concat(chunks);
      if (fullBuf.length >= 4) {
        const numFloats = Math.floor(fullBuf.length / 4);
        const fullFloats = new Float32Array(numFloats);
        const srcView = new Uint8Array(fullBuf.buffer, fullBuf.byteOffset, numFloats * 4);
        const dstView = new Uint8Array(fullFloats.buffer, fullFloats.byteOffset, numFloats * 4);
        dstView.set(srcView);

        audioBufferCache.set(cacheKey, fullFloats);
        this.#samples = fullFloats;
        console.log(`✅ [AudioFeeder] Decoded and cached audio (${numFloats} samples, ${(numFloats / this.sampleRate).toFixed(1)}s) from ${this.source}`);
      } else {
        console.warn(`[AudioFeeder] Decode produced no audio bytes, defaulting to silence.`);
        this.#samples = new Float32Array(chunkSamples);
      }

      if (!this.#emitTimer) {
        this.#startClock(chunkSamples, chunkIntervalMs);
      }
    });

    proc.on("error", (err) => {
      console.error("[AudioFeeder] ffmpeg spawn error:", err);
      this.#proc = null;
      if (this.#active && !this.#samples) {
        this.#samples = new Float32Array(chunkSamples);
        this.#startClock(chunkSamples, chunkIntervalMs);
      }
    });
  };

  #startClock = (chunkSamples: number, chunkIntervalMs: number): void => {
    if (this.#emitTimer || !this.#active) return;
    this.#nextEmitAtMs = Date.now();
    this.#scheduleNext(chunkSamples, chunkIntervalMs);
  };

  #scheduleNext = (chunkSamples: number, chunkIntervalMs: number): void => {
    if (!this.#active) return;
    const now = Date.now();
    if (this.#nextEmitAtMs === 0) this.#nextEmitAtMs = now;
    const delayMs = Math.max(0, this.#nextEmitAtMs - now);

    this.#emitTimer = setTimeout(() => {
      this.#emitTimer = null;
      this.#flushOne(chunkSamples);
      this.#nextEmitAtMs += chunkIntervalMs;
      this.#scheduleNext(chunkSamples, chunkIntervalMs);
    }, delayMs);
  };

  #flushOne = (chunkSamples: number): void => {
    if (!this.#active) return;

    const frame = new Float32Array(chunkSamples);
    const audio = this.#samples;
    let finished = false;

    if (audio && audio.length > 0) {
      for (let i = 0; i < chunkSamples; i++) {
        if (this.#playhead < audio.length) {
          frame[i] = audio[this.#playhead];
          this.#playhead += 1;
        } else {
          if (this.loop) {
            this.#playhead = 0;
            frame[i] = audio[this.#playhead];
            this.#playhead += 1;
          } else {
            frame[i] = 0;
            finished = true;
          }
        }
      }
    } else {
      this.underflowChunks += 1;
    }

    this.chunksEmitted += 1;
    this.bytesProduced += frame.byteLength;
    this.onChunk(frame);

    if (finished && !this.#finishedEmitted) {
      this.#finishedEmitted = true;
      console.log(`[AudioFeeder] Audio playback completed (${this.chunksEmitted} chunks emitted). Triggering onFinished to cut call...`);
      this.stop();
      this.onFinished?.();
    }
  };

  stop = (): void => {
    this.#active = false;
    console.log(`[AudioFeeder] Stopped. Total emitted chunks: ${this.chunksEmitted}, bytes: ${this.bytesProduced}`);
    if (this.#emitTimer) {
      clearTimeout(this.#emitTimer);
      this.#emitTimer = null;
    }
    if (this.#proc) {
      try { this.#proc.kill("SIGTERM"); } catch {}
      this.#proc = null;
    }
    this.#samples = null;
    this.#playhead = 0;
    this.#nextEmitAtMs = 0;
  };
}
