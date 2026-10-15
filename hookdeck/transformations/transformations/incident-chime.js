// An incident alert becomes a WAV chime: rising when resolved, falling when
// triggered. Synthesised sample by sample into a Buffer.
import { Buffer } from 'node:buffer';

const SAMPLE_RATE = 22050;
const NOTE_SECONDS = 0.18;

const MELODIES = {
  'incident.triggered': ['E5', 'C5', 'A4', 'E4'],
  'incident.acknowledged': ['A4', 'A4'],
  'incident.resolved': ['C5', 'E5', 'G5', 'C6'],
};

const SEMITONES = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
const frequency = (note) => 440 * 2 ** ((SEMITONES[note[0]] + (Number(note.slice(1)) - 4) * 12) / 12);

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export default {
  transform(request) {
    const alert = request.body;
    const melody = MELODIES[alert.event_type] || ['A4'];

    const perNote = Math.floor(SAMPLE_RATE * NOTE_SECONDS);
    const samples = new Float32Array(perNote * (melody.length + 2)); // the last note rings on
    melody.forEach((note, n) => {
      const hz = frequency(note);
      for (let i = 0; i < perNote * 3 && n * perNote + i < samples.length; i++) {
        const t = i / SAMPLE_RATE;
        // A bell-like tone: a fundamental and a softer octave, decaying
        const tone = Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t);
        samples[n * perNote + i] += 0.35 * tone * Math.exp(-t * 6) * Math.min(1, i / 60);
      }
    });

    request.body = wav(samples);
    request.headers['content-type'] = 'audio/wav';
    console.log(`${alert.event_type}: ${melody.join(' ')} -> ${(samples.length / SAMPLE_RATE).toFixed(2)}s WAV, ${request.body.length} bytes`);
    return request;
  },
};
