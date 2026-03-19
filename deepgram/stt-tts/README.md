# Hookdeck + Deepgram Demos

This project showcases various integrations between Deepgram's AI APIs and Hookdeck's webhook management platform.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Hookdeck Connections

Install Hookdeck CLI and create connections for TTS and STT demos:

```bash
# Install Hookdeck CLI (if not already installed)
npm install -g hookdeck

# Login to Hookdeck
hookdeck login

# Create/update TTS connection (idempotent)
hookdeck connection upsert deepgram-tts \
  --source-name deepgram-tts \
  --source-type WEBHOOK \
  --destination-name local-deepgram \
  --destination-type CLI \
  --destination-cli-path /tts/webhook

# Create/update STT connection (idempotent)
hookdeck connection upsert deepgram-stt \
  --source-name deepgram-stt \
  --source-type WEBHOOK \
  --destination-name local-deepgram \
  --destination-type CLI \
  --destination-cli-path /stt/webhook
```

**Get Source URLs:** After creating the connections, visit your [Hookdeck Dashboard](https://dashboard.hookdeck.com) to find the Source URLs for each connection (format: `https://hkdk.events/...`)

Listen for events:

```bash
hookdeck listen 4000 '*'
```

### 3. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your configuration:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key_here
PORT=4000
TTS_CALLBACK_URL=https://hkdk.events/your-tts-source-id-here
STT_CALLBACK_URL=https://hkdk.events/your-stt-source-id-here
```

- Get your Deepgram API key from [Deepgram Console](https://console.deepgram.com/)
- Copy the Source URLs from Hookdeck dashboard for TTS_CALLBACK_URL and STT_CALLBACK_URL

### 4. Start the Server

```bash
npm start
```

The server will start on `http://localhost:4000`

Open your browser to `http://localhost:4000` to see available demos.

---

## Available Demos

### 🎧 Speech-to-Text (STT) - ✅ WORKING

Record audio in your browser and transcribe it to text using Deepgram's STT API with Hookdeck webhook callbacks.

**URL:** `http://localhost:4000/stt`

**✅ CURRENT STATUS: FULLY FUNCTIONAL WITH HOOKDECK**

This demo showcases the complete Hookdeck + Deepgram integration using callbacks. Unlike TTS, STT callbacks return JSON transcriptions which are fully compatible with Hookdeck.

**How it Works:**

1. User records audio directly in the browser using MediaRecorder API
2. Recorded audio is uploaded to the server
3. Server sends audio file to Deepgram STT API with callback URL (pointing to Hookdeck Source)
4. Deepgram accepts the request and processes transcription asynchronously
5. ✅ **Deepgram sends JSON transcription to Hookdeck** (content-type: `application/json`)
6. ✅ **Hookdeck forwards the JSON webhook** to your local server
7. ✅ **Server receives transcription** and updates the request status
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

### 🗣️ Text-to-Speech (TTS) - ⚠️ NOT CURRENTLY WORKING

Generate natural-sounding speech from text using Deepgram's TTS API.

**URL:** `http://localhost:4000/tts`

**⚠️ CURRENT STATUS: NON-FUNCTIONAL WITH HOOKDECK**

This demo is configured to use Deepgram's callback-based approach but **does not work** with Hookdeck due to a fundamental limitation:

**The Problem:**
- Deepgram TTS callbacks send binary audio data with `audio/mpeg` content-type
- Hookdeck is designed for JSON webhook payloads only
- Hookdeck rejects binary data from Deepgram
- The webhook endpoint never receives the callback

**Why This Demo Exists:**
This demo serves as documentation of the limitation and shows what would be needed for callback-based TTS if Hookdeck supported binary content types in the future.

**Alternative Approach:**
For a working TTS demo, use direct API responses instead of callbacks (synchronous mode where audio is returned immediately in the HTTP response).

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

### STT Demo (✅ Working)

- `GET /stt` - STT demo interface
- `GET /stt/api/requests` - Get all transcription requests (JSON)
- `POST /stt/api/upload` - Upload audio file (multipart/form-data with `audio` field)
- `POST /stt/api/transcribe` - Start transcription (accepts `{ requestId, model }`)
- `POST /stt/webhook` - **Webhook callback handler** (✅ receives JSON transcriptions from Deepgram via Hookdeck)
- `GET /stt/audio/:filename` - Serve uploaded audio files

### TTS Demo (⚠️ Non-functional)

- `GET /tts` - TTS demo interface
- `GET /tts/api/requests` - Get all TTS requests (JSON)
- `POST /tts/api/generate` - Generate TTS with callback (accepts `{ text, model }`)
- `POST /tts/webhook` - Webhook callback handler (⚠️ never called - Hookdeck rejects binary audio)
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
- Ensure the webhook path matches: `/webhooks/deepgram/stt`

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

**This demo does not work with Hookdeck** - See the demo page for explanation of the limitation.

### General Issues

**"DEEPGRAM_API_KEY not configured" error:**
- Make sure you've created a `.env` file
- Copy from `.env.example` and add your actual API key
- Get your API key from [Deepgram Console](https://console.deepgram.com/)

**"TTS_CALLBACK_URL/STT_CALLBACK_URL not configured" error:**
- Create Hookdeck connections using the commands in setup section
- Copy Source URLs from Hookdeck dashboard
- Add them to your `.env` file

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
