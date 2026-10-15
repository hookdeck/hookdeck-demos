// Uptime check results become an SVG latency chart. No built-ins needed: a
// transformation can return a string body with any content type.
const WIDTH = 640;
const HEIGHT = 240;
const PAD = { top: 48, right: 24, bottom: 32, left: 48 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export default {
  transform(request) {
    const { monitor, checks } = request.body;
    const latencies = checks.map((c) => c.latency_ms);
    const max = Math.max(...latencies) * 1.15;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const failures = checks.filter((c) => c.status !== 'up').length;

    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (i / (checks.length - 1)) * plotW;
    const y = (ms) => PAD.top + plotH - (ms / max) * plotH;

    const line = checks.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.latency_ms).toFixed(1)}`).join(' ');
    const area = `${line} L${x(checks.length - 1).toFixed(1)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;
    const grid = [0.25, 0.5, 0.75, 1].map((f) => {
      const ms = Math.round(max * f);
      return `<line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y(ms)}" y2="${y(ms)}" stroke="#e5e2da"/>` +
        `<text x="${PAD.left - 8}" y="${y(ms) + 4}" text-anchor="end">${ms}</text>`;
    }).join('');
    const down = checks.map((c, i) => (c.status === 'up' ? '' :
      `<circle cx="${x(i)}" cy="${y(c.latency_ms)}" r="5" fill="#d93025" stroke="#fff" stroke-width="2"><title>${esc(c.at)}: ${esc(c.status)}</title></circle>`)).join('');

    request.body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" font-family="ui-monospace, Menlo, monospace" font-size="11" fill="#6b6b6b">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="#fbfaf7"/>
  <text x="${PAD.left}" y="26" font-size="14" font-weight="600" fill="#1a1a1a">${esc(monitor)}</text>
  <text x="${WIDTH - PAD.right}" y="26" text-anchor="end">p95 ${p95} ms · ${failures} failed of ${checks.length}</text>
  ${grid}
  <path d="${area}" fill="#1e8e3e" fill-opacity="0.12"/>
  <path d="${line}" fill="none" stroke="#1e8e3e" stroke-width="2" stroke-linejoin="round"/>
  ${down}
  <text x="${PAD.left}" y="${HEIGHT - 10}">${esc(checks[0].at)}</text>
  <text x="${WIDTH - PAD.right}" y="${HEIGHT - 10}" text-anchor="end">${esc(checks[checks.length - 1].at)}</text>
</svg>`;
    request.headers['content-type'] = 'image/svg+xml';
    console.log(`Charted ${checks.length} checks for ${monitor}: p95 ${p95} ms, ${failures} failed`);
    return request;
  },
};
