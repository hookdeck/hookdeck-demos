import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import { Browser, chromium, Page } from 'playwright';

// The scene kit's contract with the website's steppedDiagram component: every scripted scene has a
// desktop and a phone layout with the same steps and captions, and every resting state can be
// seeked to. Runs the built bundle in headless Chromium.
describe('topology scenes', () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    const root = path.join(__dirname, '..');
    const built = spawnSync('node', [path.join(root, 'scripts', 'build-scenes.mjs')], { cwd: root });
    assert.equal(built.status, 0, String(built.stderr));
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent('<div id="host"></div>');
    await page.addScriptTag({ path: path.join(root, 'public', 'scenes', 'scenes.js') });
  });

  after(async () => {
    await browser?.close();
  });

  for (const id of ['vapi-call-and-tool', 'vapi-two-clients', 'vapi-duplicate-dropped', 'vapi-bad-signature', 'vapi-app-down']) {
    it(`${id}: desktop and phone layouts share steps and captions`, async () => {
      const result = await page.evaluate((scene_id) => {
        const { scenes } = (window as any).HookdeckScenes;
        const host = document.getElementById('host')!;
        const out: any = {};
        for (const key of [scene_id, `${scene_id}-mobile`]) {
          const scene = scenes[key](host, { captions: false });
          // Seek every resting state, forwards then backwards, as the website's Back and Next do.
          for (const n of [...scene.stepTimes.keys(), ...[...scene.stepTimes.keys()].reverse()]) scene.goTo(n);
          out[key] = { steps: scene.steps, captions: scene.captions, times: scene.stepTimes };
          scene.destroy();
        }
        return out;
      }, id);
      const [desktop, phone] = [result[id], result[`${id}-mobile`]];
      assert.ok(desktop.steps >= 3);
      assert.equal(desktop.steps, phone.steps);
      assert.deepEqual(desktop.captions, phone.captions);
      assert.equal(desktop.captions.length, desktop.steps + 1);
      assert.ok(desktop.times.every((t: number, i: number) => i === 0 || t > desktop.times[i - 1]));
    });
  }

  it('live scene has a driver, queues packets on one edge, and has a return edge per client', async () => {
    const result = await page.evaluate(async () => {
      const { scenes } = (window as any).HookdeckScenes;
      const scene = scenes.live(document.getElementById('host')!, { captions: false });
      const live = scene.live;
      const order: string[] = [];
      const first = live.send('in_acme', { label: 'first', duration: 0.2 }).then(() => order.push('first'));
      const second = live.send('in_acme', { label: 'second', duration: 0.2 }).then(() => order.push('second'));
      const other = live.send('in_globex', { label: 'other', duration: 0.2 }).then(() => order.push('other'));
      await Promise.all([first, second, other]);
      live.badge('app_acme', 'handled · attempt 1', 'success');
      live.chip('verify', 'success', 0.1);
      // each endpoint to its own call in Vapi: the controlUrl edges
      await live.send('return_acme', { duration: 0.2 });
      await live.send('return_globex', { duration: 0.2 });
      const has_badge = document.querySelectorAll('svg.stage .overlay g').length > 0;
      scene.destroy();
      return { order, has_badge, steps: scene.steps };
    });
    assert.ok(result.order.indexOf('first') < result.order.indexOf('second'), 'one edge queues packets in order');
    assert.ok(result.order.includes('other'));
    assert.equal(result.steps, 0);
    assert.ok(result.has_badge);
  });
});
