#!/usr/bin/env node
/**
 * Copies the pieces in _shared/ into the demos listed in _shared/manifest.json.
 *
 *   npm run sync-shared                 copy, overwriting the demo copies
 *   npm run sync-shared -- --check      exit 1 and list files that differ (no writes)
 *   node scripts/sync-shared.mjs --list-demos   print the manifest's demo folders as JSON
 *
 * A demo not listed for a piece owns its own copy. Text files that can hold
 * comments (CSS, TS, JS) get a "Generated from" header; other files are copied
 * as they are, and a directory copy also gets a GENERATED.md note.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, '_shared', 'manifest.json');
const NOTE_FILE = 'GENERATED.md';

const COMMENT_STYLES = {
  '.css': (text) => `/* ${text} */\n`,
  '.ts': (text) => `// ${text}\n`,
  '.js': (text) => `// ${text}\n`,
  '.mjs': (text) => `// ${text}\n`,
  '.cjs': (text) => `// ${text}\n`,
};

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const [demo, pieces] of Object.entries(manifest.demos)) {
    if (!fs.existsSync(path.join(ROOT, demo))) throw new Error(`Manifest demo not found: ${demo}`);
    for (const piece of Object.keys(pieces)) {
      if (!manifest.pieces[piece]) throw new Error(`Manifest: ${demo} uses unknown piece "${piece}"`);
    }
  }
  return manifest;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Contents a target file should have, given its source file. */
function render(source_file, source_rel) {
  const content = fs.readFileSync(source_file);
  const comment = COMMENT_STYLES[path.extname(source_file)];
  if (!comment) return content;
  const header = comment(`Generated from \`${source_rel}\`; edit there and run \`npm run sync-shared\`.`);
  return Buffer.concat([Buffer.from(header), content]);
}

/** Map of absolute target path -> Buffer for one piece in one demo. */
function expectedFiles(piece_source, demo_dir, target) {
  const source_abs = path.join(ROOT, piece_source);
  const target_abs = path.join(ROOT, demo_dir, target);
  const expected = new Map();
  if (fs.statSync(source_abs).isDirectory()) {
    for (const file of listFiles(source_abs)) {
      const inside = path.relative(source_abs, file);
      expected.set(path.join(target_abs, inside), render(file, rel(file)));
    }
    const note = `Generated from \`${piece_source}\`. Edit there and run \`npm run sync-shared\` from the repo root; changes made in this folder are overwritten.\n`;
    expected.set(path.join(target_abs, NOTE_FILE), Buffer.from(note));
  } else {
    expected.set(target_abs, render(source_abs, piece_source));
  }
  return { expected, target_abs, is_dir: fs.statSync(source_abs).isDirectory() };
}

const hash = (buf) => createHash('sha256').update(buf).digest('hex');

function main() {
  const args = process.argv.slice(2);
  const manifest = readManifest();

  if (args.includes('--list-demos')) {
    console.log(JSON.stringify(Object.keys(manifest.demos)));
    return;
  }

  const check = args.includes('--check');
  const problems = [];
  let written = 0;

  for (const [demo, pieces] of Object.entries(manifest.demos)) {
    for (const [piece, target] of Object.entries(pieces)) {
      const { expected, target_abs, is_dir } = expectedFiles(manifest.pieces[piece], demo, target);

      // Files in a copied directory that the source no longer has
      if (is_dir && fs.existsSync(target_abs)) {
        for (const file of listFiles(target_abs)) {
          if (expected.has(file)) continue;
          if (check) problems.push(`${rel(file)} (not in ${manifest.pieces[piece]})`);
          else fs.rmSync(file);
        }
      }

      for (const [file, content] of expected) {
        const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
        if (current && hash(current) === hash(content)) continue;
        if (check) {
          problems.push(`${rel(file)} (${current ? 'differs from' : 'missing, expected from'} ${manifest.pieces[piece]})`);
        } else {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, content);
          written++;
        }
      }
    }
  }

  if (check) {
    if (problems.length) {
      console.error('Shared copies are out of date:');
      for (const p of problems) console.error(`  ${p}`);
      console.error('\nEdit files under _shared/ only, then run: npm run sync-shared');
      process.exit(1);
    }
    console.log('Shared copies are in sync.');
  } else {
    console.log(`Synced shared pieces (${written} file${written === 1 ? '' : 's'} written).`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
