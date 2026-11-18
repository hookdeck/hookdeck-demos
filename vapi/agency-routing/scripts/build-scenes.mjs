#!/usr/bin/env node
/**
 * Bundles the scene kit and the demo's scenes for the browser:
 *   public/scenes/scenes.js   global `HookdeckScenes` (scenes, scenarios, createFlowFeed, ...)
 *   public/scenes/scenes.css  styles for the scene SVG text
 *
 * Scenes import SVG icons with `?raw` (Vite's syntax, which the website uses), so a small
 * esbuild plugin loads those as text. Run by `npm start`/`npm run dev` and by `npm run capture`.
 *
 *   node scripts/build-scenes.mjs [--watch]
 */
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'scenes');

const rawSvg = {
  name: 'raw-svg',
  setup(b) {
    b.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
      path: require_resolve(args.path.replace(/\?raw$/, ''), args.resolveDir),
      namespace: 'raw-svg',
    }));
    b.onLoad({ filter: /.*/, namespace: 'raw-svg' }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }));
  },
};

function require_resolve(spec, dir) {
  // Package paths like @material-symbols/svg-400/outlined/mic.svg resolve from node_modules.
  return path.join(ROOT, 'node_modules', spec);
}

const options = {
  entryPoints: [path.join(ROOT, 'scenes', 'entry.ts')],
  outfile: path.join(OUT, 'scenes.js'),
  bundle: true,
  format: 'iife',
  globalName: 'HookdeckScenes',
  target: 'es2020',
  minify: !process.argv.includes('--watch'),
  sourcemap: false,
  plugins: [rawSvg],
  logLevel: 'warning',
};

fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scenes', 'kit', 'scenes.css'), path.join(OUT, 'scenes.css'));
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching scenes');
} else {
  await build(options);
  console.log(`built ${path.relative(ROOT, options.outfile)}`);
}
