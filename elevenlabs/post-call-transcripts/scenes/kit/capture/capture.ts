// Generated from `_shared/scenes/capture/capture.ts`; edit there and run `npm run sync-shared`.
/**
 * Renders each scripted scene to GIF and MP4 by seeking its GSAP timeline frame by frame, so
 * every frame is exact whatever the machine's speed.
 *
 *   npm run capture                          every scene, landscape, light theme: GIF + MP4
 *   npm run capture -- delivery app-down     some scenes
 *   ASPECT=square npm run capture            1080x1080 for social (phone layout + large caption)
 *   THEME=dark FORMAT=mp4 OUT=/tmp/clips npm run capture -- delivery
 *
 * Options (flags or environment): --aspect|ASPECT wide|square, --theme|THEME light|dark,
 * --format|FORMAT gif|mp4|both, --out|OUT directory (default scenes/captures), --fps|FPS
 * (default 30), --hold|HOLD seconds each resting state is held (default 1.8), --stills|STILLS
 * also write a PNG of each resting state; --stills-only|STILLS_ONLY writes the PNGs and no video.
 *
 * It serves the demo's public/ folder itself (run `npm run build:scenes` first, which this
 * command does), so the demo doesn't have to be running. Needs ffmpeg on the PATH and Playwright's
 * Chromium (`npx playwright install chromium`), or an installed Google Chrome.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type Browser, chromium } from 'playwright'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    aspect: { type: 'string' },
    theme: { type: 'string' },
    format: { type: 'string' },
    out: { type: 'string' },
    fps: { type: 'string' },
    hold: { type: 'string' },
    'stills': { type: 'boolean' },
    'stills-only': { type: 'boolean' },
  },
})

const ROOT = process.cwd()
const aspect = values.aspect ?? process.env.ASPECT ?? 'wide'
const theme = values.theme ?? process.env.THEME ?? 'light'
const format = values.format ?? process.env.FORMAT ?? 'both'
const fps = Number(values.fps ?? process.env.FPS ?? 30)
const hold = Number(values.hold ?? process.env.HOLD ?? 1.8)
const stills_only = values['stills-only'] ?? Boolean(process.env.STILLS_ONLY)
const stills = stills_only || (values.stills ?? Boolean(process.env.STILLS))
const out = path.resolve(values.out ?? process.env.OUT ?? path.join(ROOT, 'scenes', 'captures'))
if (!['wide', 'square'].includes(aspect))
  throw new Error('ASPECT must be wide or square')
if (!['light', 'dark'].includes(theme))
  throw new Error('THEME must be light or dark')
const size = aspect === 'square' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }
const ALL = ['delivery', 'duplicate', 'bad-signature', 'app-down']
const names = positionals.length ? positionals : ALL

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }

function serve(): Promise<{ base: string, close: () => void }> {
  const pub = path.join(ROOT, 'public')
  const page = path.join(ROOT, 'scenes', 'kit', 'capture', 'page.html')
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const file = url.pathname === '/capture' ? page : path.join(pub, path.normalize(url.pathname))
    if (!file.startsWith(pub) && file !== page) {
      res.writeHead(403).end()
      return
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(data)
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number }
    resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() })
  }))
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch()
  }
  catch {
    return await chromium.launch({ channel: 'chrome' })
  }
}

function ffmpeg(argv: string[], input?: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...argv], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'inherit'] })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))
    if (input)
      input(child.stdin!).then(() => child.stdin!.end(), reject)
  })
}

async function capture(browser: Browser, base: string, name: string) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
  await page.goto(`${base}/capture?scene=${name}&aspect=${aspect}&theme=${theme}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => (window as any).__captureReady === true, undefined, { timeout: 30_000 })
  const { stepTimes } = await page.evaluate(() => ({ stepTimes: (window as any).__capture.stepTimes as number[] }))

  const frameAt = async (time: number) => {
    // Block body: seek() returns nothing, but keep Playwright from serializing anything back.
    await page.evaluate((t) => { (window as any).__capture.seek(t) }, time)
    return page.screenshot({ type: 'png' })
  }

  const suffix = `${aspect === 'square' ? '-square' : ''}${theme === 'dark' ? '-dark' : ''}`
  fs.mkdirSync(out, { recursive: true })
  if (stills) {
    for (const [i, time] of stepTimes.entries()) {
      const file = path.join(out, `${name}${suffix}-step${i}.png`)
      fs.writeFileSync(file, await frameAt(time))
      console.log(`wrote ${file}`)
    }
  }

  if (stills_only) {
    await page.close()
    return
  }
  const mp4 = path.join(out, `${name}${suffix}.mp4`)
  let frames = 0
  await ffmpeg(['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-preset', 'slow', '-r', String(fps), '-movflags', '+faststart', '-an', mp4], async (stdin) => {
    const write = (png: Buffer) => new Promise<void>(resolve => stdin.write(png) ? resolve() : stdin.once('drain', () => resolve()))
    // The intro starts from an empty stage: play it, then hold each resting state and play the transition to the next.
    for (let t = 0; t < stepTimes[0]; t += 1 / fps, frames++)
      await write(await frameAt(t))
    for (let i = 0; i < stepTimes.length; i++) {
      const still = await frameAt(stepTimes[i])
      const last = i === stepTimes.length - 1
      const seconds = last ? hold * 2 : i === 0 ? hold * 0.8 : hold
      for (let f = 0; f < Math.round(seconds * fps); f++, frames++)
        await write(still)
      if (last)
        break
      const [from, to] = [stepTimes[i], stepTimes[i + 1]]
      for (let t = from + 1 / fps; t < to; t += 1 / fps, frames++)
        await write(await frameAt(t))
    }
  })
  console.log(`wrote ${mp4} (${frames} frames, ${(frames / fps).toFixed(1)} s)`)
  await page.close()

  if (format === 'mp4')
    return
  const gif = path.join(out, `${name}${suffix}.gif`)
  const width = aspect === 'square' ? 720 : 960
  await ffmpeg(['-i', mp4, '-vf', `fps=15,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', gif])
  console.log(`wrote ${gif} (${(fs.statSync(gif).size / 1024 / 1024).toFixed(1)} MB)`)
  if (format === 'gif')
    fs.rmSync(mp4)
}

async function main() {
  if (spawnSync('ffmpeg', ['-version']).status !== 0)
    throw new Error('ffmpeg is required on the PATH')
  spawnSync('node', [path.join(ROOT, 'scripts', 'build-scenes.mjs')], { stdio: 'inherit' })
  const { base, close } = await serve()
  const browser = await launch()
  try {
    for (const name of names) {
      if (!ALL.includes(name))
        throw new Error(`Unknown scene "${name}". Scenes: ${ALL.join(', ')}`)
      await capture(browser, base, name)
    }
  }
  finally {
    await browser.close()
    close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
