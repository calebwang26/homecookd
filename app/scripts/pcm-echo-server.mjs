// First-hour check (docs/build/STACK.md): does a dev build stream the mic as 16 kHz mono 16-bit PCM?
// A stand-in for the voice service's /cook socket on this laptop:
//
//   node app/scripts/pcm-echo-server.mjs            (port 8787)
//   app/.env: EXPO_PUBLIC_VOICE_URL=ws://<this Mac's Wi-Fi IP>:8787
//
// Every second it prints how much audio arrived and how loud it was. Every 5 s of audio it plays the
// last 2 s back to the phone as a `say` (labelled "AI voice" there), which checks the way back too.
// On hang-up it saves what it heard to a WAV in the system temp folder: open it to hear the kid.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ws = require('ws'); // already in app/node_modules (Metro uses it); v7 calls it Server
const WebSocketServer = ws.WebSocketServer ?? ws.Server;

const PORT = Number(process.env.PORT || 8787);
const RATE = 16000;
const wss = new WebSocketServer({ port: PORT, path: '/cook' });

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const rms = (buf) => {
  let sum = 0;
  const n = Math.floor(buf.length / 2);
  for (let i = 0; i < n; i++) sum += buf.readInt16LE(i * 2) ** 2;
  return n ? Math.sqrt(sum / n) / 32768 : 0;
};

wss.on('connection', (sock, req) => {
  const url = new URL(req.url, 'http://x');
  console.log(`connected · recipe=${url.searchParams.get('recipe')} · session ${url.searchParams.get('session') ? 'yes' : 'no'}`);
  const chunks = [];
  let total = 0;
  let second = [];
  let echoedAt = 0;
  sock.on('message', (data, isBinary) => {
    // ws 8+ says isBinary; ws 7 gives text as a string.
    if (!(isBinary ?? typeof data !== 'string')) {
      console.log('text', String(data));
      return;
    }
    const buf = Buffer.from(data);
    chunks.push(buf);
    second.push(buf);
    total += buf.length;
    const secs = total / (RATE * 2);
    if (Buffer.concat(second).length >= RATE * 2) {
      const s = Buffer.concat(second);
      console.log(`${secs.toFixed(1)} s · ${s.length} bytes this second · level ${(rms(s) * 100).toFixed(1)}%`);
      sock.send(JSON.stringify({ type: 'transcript', text: `Heard ${Math.round(secs)} s · level ${Math.round(rms(s) * 100)}%` }));
      second = [];
    }
    if (secs - echoedAt >= 5) {
      echoedAt = secs;
      const all = Buffer.concat(chunks);
      const last = all.subarray(Math.max(0, all.length - RATE * 2 * 2));
      sock.send(JSON.stringify({ type: 'say', text: 'echo', ai: true, sampleRate: RATE }));
      for (let i = 0; i < last.length; i += 8192) sock.send(last.subarray(i, i + 8192));
      sock.send(JSON.stringify({ type: 'say_end' }));
    }
  });
  sock.on('close', () => {
    const file = join(tmpdir(), `homecookd-mic-${Date.now()}.wav`);
    writeFileSync(file, wav(Buffer.concat(chunks)));
    console.log(`closed · ${(total / (RATE * 2)).toFixed(1)} s of audio · saved ${file}`);
  });
});

console.log(`PCM test socket on ws://0.0.0.0:${PORT}/cook`);
