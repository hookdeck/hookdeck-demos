# Hookdeck + Deepgram Demos

This project showcases various integrations between Deepgram's AI APIs and Hookdeck's webhook management platform.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Add your Deepgram API key (from the [Deepgram Console](https://console.deepgram.com/)) to `.env`:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

### 3. Set up Hookdeck Connections

The Hookdeck CLI is an npm dependency (`hookdeck-cli` 3.1.0, the first release that forwards binary bodies such as the TTS audio), installed by `npm install`. Log in:

```bash
npx hookdeck login
```

Create the connections and write their Source URLs into `.env`:

```bash
npm run setup
```

The script is idempotent. It creates one connection per demo, each with its own CLI destination:

| Connection | Source | Destination | CLI path |
|---|---|---|---|
| `deepgram-tts` | `deepgram-tts` | `local-deepgram-tts` | `/tts/webhook` |
| `deepgram-stt` | `deepgram-stt` | `local-deepgram-stt` | `/stt/webhook` |

To use a different CLI binary (for example a local build), set `HOOKDECK_CLI=/path/to/hookdeck`.

Listen for events:

```bash
npm run listen
```

### 4. Start the Server

```bash
npm start
```

The server will start on `http://localhost:4000`

Open your browser to `http://localhost:4000` to see available demos.

---

## Available Demos

### 🎧 Speech-to-Text (STT)

Record audio in your browser and transcribe it to text using Deepgram's STT API with Hookdeck webhook callbacks.

**URL:** `http://localhost:4000/stt`

Deepgram returns the transcription as a JSON callback, delivered through Hookdeck.

**How it Works:**

1. User records audio directly in the browser using MediaRecorder API
2. Recorded audio is uploaded to the server
3. Server sends audio file to Deepgram STT API with callback URL (pointing to Hookdeck Source)
4. Deepgram accepts the request and processes transcription asynchronously
5. **Deepgram sends JSON transcription to Hookdeck** (content-type: `application/json`)
6. **Hookdeck forwards the JSON webhook** to your local server
7. **Server receives transcription** and updates the request status
8. User sees the transcription in real-time

**Features:**
- 🎤 Browser-based audio recording using MediaRecorder API
- 📤 File upload with multipart/form-data
- 🔄 Webhook-based async processing via Hookdeck
- 📝 Real-time transcription display
- 🎧 Audio playback for recorded files
- 📊 Request status tracking (pending/completed/failed)
- 💾 JSON persistence for transcription history
- 🔄 Auto-refresh when requests are pending
- 🎛️ Multiple Deepgram model options (Nova-2, Enhanced, Base, etc.)

**Supported Features:**
- Smart formatting and punctuation
- Multiple Deepgram models
- Duration tracking
- Error handling and retry logic

**Technical Details:**
- Audio format: WebM (browser default) or WAV/MP3
- Max file size: 50MB
- Callback response: JSON with transcription text
- Auto-refresh: Every 3 seconds when pending requests exist

### 🗣️ Text-to-Speech (TTS)

Generate natural-sounding speech from text using Deepgram's TTS API, with the generated audio delivered as a binary webhook through Hookdeck.

**URL:** `http://localhost:4000/tts`

**How it Works:**

1. User enters text and picks a voice model
2. Server calls Deepgram's `/v1/speak` API with a callback URL (pointing to the Hookdeck Source)
3. Deepgram accepts the request and generates the audio asynchronously
4. **Deepgram POSTs the audio to Hookdeck** as a raw binary body (content-type: `audio/mpeg`)
5. **Hookdeck forwards the bytes unchanged** to your local server via the CLI, as `application/octet-stream`
6. **Server writes the body to disk** as an MP3 and marks the request completed
7. User plays the audio in the browser

Hookdeck ingests binary bodies sent as `application/octet-stream`, `application/pdf`, `image/*` or `multipart/form-data`. `audio/mpeg` isn't on that list, so the callback URL includes `x-hookdeck-content-type=application/octet-stream` to tell Hookdeck to treat the body as binary. A retried event is redelivered byte-exact.

### 📊 Audio Intelligence - Coming Soon

Extract insights from audio using Deepgram's intelligence features.

---

## Project Structure

```
deepgram/stt-tts/
├── .env.example              # Environment variables template
├── .gitignore               # Git ignore patterns
├── README.md                # This file
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── data/                    # Data storage (created automatically)
│   ├── stt/                 # STT demo data
│   │   ├── audio/           # Uploaded audio files
│   │   └── requests.json    # Transcription request tracking
│   └── tts/                 # TTS demo data
│       ├── audio/           # Generated audio files
│       └── requests.json    # Request tracking
├── scripts/
│   └── setup-hookdeck.ts    # Creates Hookdeck connections, writes .env
├── public/                  # Static web files
│   ├── index.html           # Landing page
│   ├── stt/                 # STT demo UI
│   │   ├── index.html       # STT interface
│   │   ├── styles.css       # STT styles
│   │   └── app.js           # STT client-side JavaScript
│   └── tts/                 # TTS demo UI
│       ├── index.html       # TTS interface
│       ├── styles.css       # TTS styles
│       └── app.js           # TTS client-side JavaScript
└── src/
    ├── server.ts            # Main Express server
    └── demos/
        ├── stt/
        │   └── router.ts    # STT demo routes and logic
        └── tts/
            └── router.ts    # TTS demo routes and logic
```

---

## API Endpoints

### Main Server

- `GET /` - Landing page with demo links
- `GET /api/health` - Health check endpoint

### STT Demo

- `GET /stt` - STT demo interface
- `GET /stt/api/requests` - Get all transcription requests (JSON)
- `POST /stt/api/upload` - Upload audio file (multipart/form-data with `audio` field)
- `POST /stt/api/transcribe` - Start transcription (accepts `{ requestId, model }`)
- `POST /stt/webhook` - **Webhook callback handler** (receives JSON transcriptions from Deepgram via Hookdeck)
- `GET /stt/audio/:filename` - Serve uploaded audio files

### TTS Demo

- `GET /tts` - TTS demo interface
- `GET /tts/api/requests` - Get all TTS requests (JSON)
- `POST /tts/api/generate` - Generate TTS with callback (accepts `{ text, model }`)
- `POST /tts/webhook` - **Webhook callback handler** (receives binary `audio/mpeg` from Deepgram via Hookdeck)
- `GET /tts/audio/:filename` - Serve generated audio files

---

## Development

The project uses:
- **TypeScript** for type safety
- **Express.js** for the web server
- **dotenv** for environment variable management
- **uuid** for generating unique request IDs
- **multer** for handling file uploads (STT demo)

Each demo is organized as a separate router module, making it easy to add new demos without affecting existing ones.

---

## Adding New Demos

To add a new demo:

1. Create a new router in `src/demos/{demo-name}/router.ts`
2. Import and mount it in `src/server.ts`
3. Create UI files in `public/{demo-name}/`
4. Add a card to the landing page in `public/index.html`
5. Update this README

---

## Troubleshooting

### STT Demo

**Microphone access denied:**
- Grant microphone permissions in your browser
- Check browser settings for microphone access
- Try using HTTPS or localhost (required for MediaRecorder)

**Transcription stuck in "pending" status:**
- Check that Hookdeck connections are properly configured
- Verify STT_CALLBACK_URL is correct in `.env`
- Check server console for webhook callback logs
- Inspect Hookdeck dashboard for webhook delivery status
- Ensure the webhook path matches: `/stt/webhook`

**Recording not working:**
- Ensure you're using a modern browser (Chrome, Firefox, Edge)
- Check browser console for MediaRecorder errors
- Verify microphone is connected and working
- Try a different browser if issues persist

**Upload fails:**
- Check file size (max 50MB)
- Verify audio format is supported (WebM, WAV, MP3, OGG)
- Check server logs for upload errors
- Ensure `data/stt/audio/` directory is writable

### TTS Demo

**Request stuck in "pending" status:**
- Check that `hookdeck listen` is running and that TTS_CALLBACK_URL is correct in `.env`
- Check the Hookdeck dashboard: a failed attempt with `CLI_BINARY_UNSUPPORTED` means your CLI is too old to forward binary bodies. Upgrade it, then retry the event

### General Issues

**"DEEPGRAM_API_KEY not configured" error:**
- Make sure you've created a `.env` file
- Copy from `.env.example` and add your actual API key
- Get your API key from [Deepgram Console](https://console.deepgram.com/)

**"TTS_CALLBACK_URL/STT_CALLBACK_URL not configured" error:**
- Run `npm run setup` to create the connections and write the Source URLs to `.env`

**`npm run setup` says a connection points at the wrong destination:**
- Earlier versions of this demo shared one `local-deepgram` destination between both connections, so TTS callbacks went to `/stt/webhook`
- A connection's destination can't be changed. Delete the connection with the command the script prints, then run `npm run setup` again

**Server won't start:**
- Make sure you've run `npm install`
- Check that port 4000 isn't already in use
- Verify Node.js version is 14.17 or higher
- Check for TypeScript compilation errors

---

## About Hookdeck

[Hookdeck](https://hookdeck.com) provides webhook management infrastructure including:
- 🔍 **Observability** - View and inspect all webhook deliveries
- 🔄 **Reliability** - Automatic retries and queuing
- 🎛️ **Control** - Filter, transform, and rate limit webhooks
- 🚀 **Development** - Test webhooks locally without exposing your machine

---

## About Deepgram

[Deepgram](https://deepgram.com) provides AI-powered speech recognition and synthesis APIs:
- 🗣️ **Text-to-Speech** - Natural-sounding voice synthesis
- 🎧 **Speech-to-Text** - Accurate transcription
- 📊 **Audio Intelligence** - Sentiment, topic detection, and more

---

## License

ISC
