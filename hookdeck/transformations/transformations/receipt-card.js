// A payment event becomes a PNG receipt card. The avatar is an identicon
// derived from the customer ID, so each customer always gets the same one.
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

const WIDTH = 640;
const HEIGHT = 220;

// 5x7 pixel font: one number per row, the 5 low bits are the pixels
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8],
  '$': [4, 15, 20, 14, 5, 30, 4], '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [0, 1, 2, 4, 8, 16, 0], '#': [10, 10, 31, 10, 31, 10, 10], '@': [14, 17, 23, 21, 23, 16, 15],
  '_': [0, 0, 0, 0, 0, 0, 31], '!': [4, 4, 4, 4, 4, 0, 4],
};

const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);

function rect(x, y, w, h, [r, g, b]) {
  for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + h); row++) {
    for (let col = Math.max(0, x); col < Math.min(WIDTH, x + w); col++) {
      const i = (row * WIDTH + col) * 3;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }
}

function text(str, x, y, scale, color) {
  for (const ch of String(str).toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    glyph.forEach((bits, row) => {
      for (let col = 0; col < 5; col++) {
        if (bits & (16 >> col)) rect(x + col * scale, y + row * scale, scale, scale, color);
      }
    });
    x += 6 * scale;
  }
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

// A 5x5 grid mirrored left to right, coloured and filled from a hash of the ID
function identicon(id, x, y, size) {
  const hash = createHash('sha256').update(id).digest();
  const color = hsl((hash[0] / 255) * 360, 0.6, 0.5);
  rect(x, y, size, size, hsl((hash[0] / 255) * 360, 0.6, 0.93));
  const cell = Math.floor(size / 7);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (hash[1 + row * 3 + col] % 2 === 0) continue;
      rect(x + cell * (1 + col), y + cell * (1 + row), cell, cell, color);
      rect(x + cell * (5 - col), y + cell * (1 + row), cell, cell, color);
    }
  }
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  // Each scanline starts with a filter byte (0: none)
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) {
    pixels.copy(raw, row * (WIDTH * 3 + 1) + 1, row * WIDTH * 3, (row + 1) * WIDTH * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const money = (amount, currency) =>
  `${currency === 'usd' ? '$' : ''}${(amount / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${currency}`;

export default {
  transform(request) {
    const event = request.body;
    const payment = event.data.object;

    rect(0, 0, WIDTH, HEIGHT, [251, 250, 247]);
    rect(0, 0, 8, HEIGHT, [30, 142, 62]);
    identicon(payment.customer, 32, 40, 140);
    text('Payment succeeded', 200, 40, 2, [30, 142, 62]);
    text(money(payment.amount, payment.currency), 200, 70, 5, [26, 26, 26]);
    text(payment.description, 200, 124, 2, [80, 80, 80]);
    text(payment.receipt_email, 200, 150, 2, [120, 120, 120]);
    text(event.id, 200, 184, 1, [160, 160, 160]);

    request.body = png();
    request.headers['content-type'] = 'image/png';
    console.log(`Rendered a ${WIDTH}x${HEIGHT} receipt for ${payment.customer}: ${request.body.length} bytes`);
    return request;
  },
};
