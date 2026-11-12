# Scene kit

Animated topology diagrams for Hookdeck demos, guides and social posts. One scene file defines a topology (components, connectors, status badges, capability chips) and gives:

1. **A live view** for a demo page: packets move along the edges as real events arrive, nodes show status badges, Event Gateway's chips flash.
2. **Scripted scenes with captions** (desktop 1920x1080 and a portrait phone layout, same steps and captions), embeddable in hookdeck.com guides through the website's `steppedDiagram` component.
3. **GIF and MP4 captures** (landscape, and 1080x1080 for social), frame-exact because the capture script seeks the scene's GSAP timeline.

Built from the `hookdeck-presentations` skill's scene kit (TypeScript, SVG, GSAP, one paused timeline per scene), with a live driver and design-system theming added. This folder is the source of truth: `node scripts/sync-shared.mjs` copies it into each demo that lists it in `_shared/manifest.json` (here `scenes/kit/`).

## Files

| File | What it is |
| --- | --- |
| `scene.ts` | `defineScene(name, build, { canvas })`: one paused timeline, labels `step0..stepN`, `scene.captions`, `scene.live` |
| `stage.ts` | `node()` (card with icon tile, eyebrow, title; `variant: 'work'` is the blue Event Gateway card), `connector()` (`h` or `v`), layers |
| `anim.ts` | `packet()`, `travel()`, `bounce()`, `dropAt()`, `down()`, `up()`, `accepted()`, `pulse()`, `show/hide/swap`, `draw`, `captions()` |
| `parts.ts` | `chip()`, `toneChip()` / `chipRow()` (capability chips that change tone), `statusChip()`, `connectorLabel()` |
| `live.ts` | `createLive()`: `send(edge)` (queued per edge), `badge()`, `state()`, `chip()`, `onSelect()` |
| `tokens.ts`, `svg.ts` | Colors as design-system CSS variables (light and dark follow the host), Material Symbols icons plus the Hookdeck mark |
| `scenes.css` | Text styles and the two variables the design system lacks |
| `host/flow-feed.ts` | Demo-page host (not for the website): turns `/api/flow` and the app's own delivery feed into live-driver calls |
| `capture/` | `page.html` and `capture.ts`: the GIF and MP4 export |

## Rules that keep scenes reusable

1. **No host code in a scene file.** Import `gsap`, `gsap/CustomEase`, `@material-symbols/svg-400` icons and the kit, nothing else. A website copy runs as is. Pinned versions: `gsap` 3.15.0, `@material-symbols/svg-400` 0.47.4 (the website and the presentation repo pin the same).
2. **Only `.to()` tweens from a state set at build time**, so any seek renders the same frame. Colors are `var(...)`, which GSAP cannot tween: build two layers and fade them (the packet's red head, the chip tones).
3. **Captions in every scripted scene**, one whole sentence per resting state, exported as `…Captions` arrays of strings (the website's sync reads them without running the scene). Backticks mark code.
4. **A phone layout for every scripted scene**, 640 units wide, with the same steps and captions. Share the builder and pass a layout, as `scenes/post-call.ts` does.
5. **Show the live view with `scene.live`**, and keep the live scene's node, edge and chip ids stable (`agent`, `gateway`, `listen`, `app`; `in`, `out`, `local`; `verify`, `store`, `dedup`, `retry`).

## Adding a demo

See the notes in `docs`-style form in the demo that pilots it: `elevenlabs/post-call-transcripts/scenes/post-call.ts`. In short: add `"scenes": "scenes/kit"` to the demo in `_shared/manifest.json`, run `sync-shared`, write `scenes/<demo>.ts` (layouts, `buildParts`, scenarios), an `entry.ts`, copy `scripts/build-scenes.mjs`, and add `build:scenes` and `capture` scripts.
