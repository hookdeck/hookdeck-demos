# Binary payloads: which content types work?

Sends one fixture per content type through a Hookdeck Event Gateway source to a local receiver via `hookdeck listen`, and reports, for each type:

- **ingestion:** whether Hookdeck accepted the request or rejected it, and why (`rejection_cause`)
- **delivered:** whether it reached the local receiver
- **byte-exact:** whether the SHA-256 of what arrived matches what was sent
- **received as:** the `Content-Type` the receiver saw

Ingestion answers `200` even when it rejects a request, so the script reads the outcome from the API rather than the ingestion response.

## How ingestion classifies a request

Hookdeck doesn't keep a list of every content type. Ingestion ([`cloudflare/src/common/ingest.ts`](https://github.com/hookdeck/http-ingestion/blob/main/cloudflare/src/common/ingest.ts)) applies three rules:

| Rule | Matches | Outcome |
|---|---|---|
| Text | `text/*`; `application/json`, `+json`, the AWS JSON types; `application/xml`, `+xml`; `application/x-ndjson`, `application/x-www-form-urlencoded`, `application/jwt`; no `Content-Type` | Accepted as text |
| Binary allowlist | `application/octet-stream`, `application/pdf`, any `image/*`, `multipart/form-data`, gzip `Content-Encoding`, and since 2026-10-02 `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`, `video/mp4`, `video/webm`, `application/zip`, `application/gzip`, `application/x-tar`, `application/x-protobuf`, `application/protobuf`, `application/cbor`, `application/msgpack`, `application/vnd.apache.avro+binary`, `application/wasm`, `font/woff2` | Accepted, bytes and `Content-Type` preserved |
| Everything else | Any other media type, e.g. `audio/mp3`, `audio/x-wav`, `audio/flac`, `video/quicktime` | Rejected with `UNSUPPORTED_CONTENT_TYPE` |

The allowlist is an explicit list of media types (plus any `image/*`), not a pattern, so common aliases like `audio/mp3` and `audio/x-wav` are rejected even though `audio/mpeg` and `audio/wav` are accepted.

The cases below are representatives of each rule plus formats people commonly send as webhooks: 30 content types in 31 cases, and an override variant of each of the 5 still-rejected ones, for 36 sends. "Everything else is rejected" is from the code; the demo tests the types listed, not every possible type.

## Cases

| Group | Content types |
|---|---|
| Text controls | `application/json`, `text/plain` |
| Original allowlist | `application/octet-stream`, `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `multipart/form-data` (PNG + MP3 parts), gzip `Content-Encoding` |
| Added 2026-10-02: audio and video | `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`, `video/mp4`, `video/webm` |
| Added 2026-10-02: archives | `application/zip`, `application/gzip`, `application/x-tar` |
| Added 2026-10-02: serialization | `application/x-protobuf`, `application/protobuf`, `application/cbor`, `application/msgpack`, `application/vnd.apache.avro+binary` |
| Added 2026-10-02: other | `application/wasm`, `font/woff2` |
| Still not on the allowlist | `audio/mp3`, `audio/x-wav`, `audio/flac`, `audio/aac`, `video/quicktime`, each also sent with `?x-hookdeck-content-type=application/octet-stream` |

Fixtures are real files: audio, video, images and archives in [`fixtures/`](fixtures) (regenerate with `scripts/make-fixtures.sh`, which needs `ffmpeg`), and a PDF, wasm module and protobuf, CBOR, MessagePack and Avro encodings of the same small record built in [`src/cases.ts`](src/cases.ts). `octet-stream` and `woff2` are synthetic bytes. Hookdeck classifies by `Content-Type`, not by sniffing the body.

## Run it

Use a dedicated test project: the script creates a source, a CLI destination and a connection, all named `binary-payloads`.

```bash
npm install
cp .env.example .env   # add HOOKDECK_API_KEY
npm test
```

Run only some cases with `npm test -- mp3 png`.

### UI

```bash
npm run ui
```

Open http://localhost:4300 to send cases one at a time, by group, or all at once. Each row shows the ingestion outcome, the time from send to delivery through the CLI with the Hookdeck event ID, whether the bytes match, and the `Content-Type` that arrived. Preview renders what arrived: images, audio, video, PDF, archive and multipart entries, decompressed gzip, and a hex dump. Stop the listener from the page to see that nothing is delivered without it: events sent while it's stopped aren't replayed when it reconnects, so retry them from the dashboard.

The Hookdeck CLI is an npm dependency (`hookdeck-cli` 3.1.0, the first release that forwards binary bodies), so `npm install` is all you need. To try a different build, set `HOOKDECK_CLI=/path/to/hookdeck`. With v3.0.3 or earlier, binary events fail with `CLI_BINARY_UNSUPPORTED`, and multipart still arrives, but as lossy text.

The CLI logs in to the API key's project in a config file of its own (`run/hookdeck-cli.toml`), so it never touches the project you're logged in to interactively.

Results print as a table and are written to `results/latest.json` and `results/latest.md`.

## Results

Run on 2026-10-05 against production (`https://api.hookdeck.com/2026-09-01`) with `hookdeck-cli` 3.1.0, after ingestion's allowlist was expanded on 2026-10-02 ([http-ingestion `f4e490d5`](https://github.com/hookdeck/http-ingestion/commit/f4e490d5)). 31 of 36 cases arrived byte-exact; the other 5 were rejected at ingestion.

| Group | Sent as-is | With `x-hookdeck-content-type=application/octet-stream` |
|---|---|---|
| Text controls | ✅ byte-exact | n/a |
| Original allowlist (`application/octet-stream`, `application/pdf`, `image/*`, `multipart/form-data`, gzip `Content-Encoding`) | ✅ byte-exact, `Content-Type` preserved | n/a |
| Added 2026-10-02 (17 audio, video, archive, serialization, wasm and font types) | ✅ byte-exact, `Content-Type` preserved | n/a |
| Still not on the allowlist (`audio/mp3`, `audio/x-wav`, `audio/flac`, `audio/aac`, `video/quicktime`) | ❌ `UNSUPPORTED_CONTENT_TYPE` | ✅ byte-exact, arrives as `application/octet-stream` |

Before 2026-10-02, the 17 added types were rejected as-is and only arrived with the override. The demo's results made the case for adding them; the Deepgram TTS demo no longer needs the override.

The override is a workaround, not a fix. It relabels the request as `application/octet-stream`, so the receiver gets that instead of the real type, and it's a query parameter on the source URL that has to be added by hand.
