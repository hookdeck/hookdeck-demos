# Binary payloads: which content types work?

Sends one fixture per content type through a Hookdeck Event Gateway source to a local receiver via `hookdeck listen`, and reports, for each type:

- **ingestion:** whether Hookdeck accepted the request or rejected it, and why (`rejection_cause`)
- **delivered:** whether it reached the local receiver
- **byte-exact:** whether the SHA-256 of what arrived matches what was sent
- **received as:** the `Content-Type` the receiver saw

Ingestion answers `200` even when it rejects a request, so the script reads the outcome from the API rather than the ingestion response.

## Cases

| Group | Content types |
|---|---|
| Text controls | `application/json`, `text/plain` |
| Binary allowlist | `application/octet-stream`, `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `multipart/form-data` (PNG + MP3 parts), gzip `Content-Encoding` |
| Audio and video | `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`, `video/mp4`, `video/webm` |
| Archives | `application/zip`, `application/gzip`, `application/x-tar` |
| Serialisation | `application/x-protobuf`, `application/protobuf`, `application/cbor`, `application/msgpack`, `application/vnd.apache.avro+binary` |
| Other | `application/wasm`, `font/woff2` |
| Workaround | `audio/mpeg` with `?x-hookdeck-content-type=application/octet-stream` |

Fixtures are real files: audio, video, images and archives in [`fixtures/`](fixtures) (regenerate with `scripts/make-fixtures.sh`, which needs `ffmpeg`), and a PDF, wasm module and protobuf, CBOR, MessagePack and Avro encodings of the same small record built in [`src/cases.ts`](src/cases.ts). `octet-stream` and `woff2` are synthetic bytes. Hookdeck classifies by `Content-Type`, not by sniffing the body.

## Run it

Use a dedicated test project: the script creates a source, a CLI destination and a connection, all named `binary-formats`.

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

Run on 2026-10-02 against production (`https://api.hookdeck.com/2026-09-01`) with a CLI built from [hookdeck-cli#463](https://github.com/hookdeck/hookdeck-cli/pull/463), the change released in 3.1.0. 26 of 43 cases arrived byte-exact; the rest were rejected at ingestion.

| Group | Sent as-is | With `x-hookdeck-content-type=application/octet-stream` |
|---|---|---|
| Text controls (`application/json`, `text/plain`) | ✅ byte-exact | n/a |
| Allowlist (`application/octet-stream`, `application/pdf`, `image/*`, `multipart/form-data`, gzip `Content-Encoding`) | ✅ byte-exact, `Content-Type` preserved | n/a |
| Audio (`audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`) | ❌ `UNSUPPORTED_CONTENT_TYPE` | ✅ byte-exact, arrives as `application/octet-stream` |
| Video (`video/mp4`, `video/webm`) | ❌ `UNSUPPORTED_CONTENT_TYPE` | ✅ byte-exact, arrives as `application/octet-stream` |
| Archives (`application/zip`, `application/gzip`, `application/x-tar`) | ❌ `UNSUPPORTED_CONTENT_TYPE` | ✅ byte-exact, arrives as `application/octet-stream` |
| Serialisation (`application/x-protobuf`, `application/protobuf`, `application/cbor`, `application/msgpack`, `application/vnd.apache.avro+binary`) | ❌ `UNSUPPORTED_CONTENT_TYPE` | ✅ byte-exact, arrives as `application/octet-stream` |
| Other (`application/wasm`, `font/woff2`) | ❌ `UNSUPPORTED_CONTENT_TYPE` | ✅ byte-exact, arrives as `application/octet-stream` |

The override sets the request's content type, so these arrive as `application/octet-stream`, as requested. Using it to get past the allowlist means the receiver no longer gets the real type (`audio/mpeg` and so on) and has to know the format from context.

The override is a query parameter on the source URL, so it only works where the sender lets you set the full URL, such as a callback URL (Deepgram) or a webhook URL you register with the parameter included. It doesn't help if a provider strips query strings, and every integrator has to know to add it.
