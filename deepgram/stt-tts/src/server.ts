import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';

// Validate required environment variables
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const TTS_CALLBACK_URL = process.env.TTS_CALLBACK_URL;
const STT_CALLBACK_URL = process.env.STT_CALLBACK_URL;

if (!DEEPGRAM_API_KEY) {
  console.error('❌ ERROR: DEEPGRAM_API_KEY is not set in .env file');
  console.error('Please add your Deepgram API key to the .env file');
  console.error('Get your API key from: https://console.deepgram.com/');
  process.exit(1);
}

if (!TTS_CALLBACK_URL) {
  console.error('❌ ERROR: TTS_CALLBACK_URL is not set in .env file');
  console.error('Please set up Hookdeck connections as described in README.md');
  process.exit(1);
}

if (!STT_CALLBACK_URL) {
  console.error('❌ ERROR: STT_CALLBACK_URL is not set in .env file');
  console.error('Please set up Hookdeck connections as described in README.md');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());
app.use(express.raw({ type: 'audio/*', limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Import demo routers
import ttsRouter from './demos/tts/router';
import sttRouter from './demos/stt/router';

// Mount demo routes
app.use('/tts', ttsRouter);
app.use('/stt', sttRouter);

// Note: Webhook endpoints are handled directly by the demo routers
// - STT webhook: /stt/webhook (working - receives JSON)
// - TTS webhook: /tts/webhook (not working - Hookdeck rejects binary data)

// Landing page (served from public/index.html)
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    deepgram: DEEPGRAM_API_KEY ? 'configured' : 'not configured'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Hookdeck Deepgram Demos running on http://localhost:${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  console.log(`💡 DEEPGRAM_API_KEY: ${DEEPGRAM_API_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log('');
  console.log('Available demos:');
  console.log(`  - TTS (Text-to-Speech): http://localhost:${PORT}/tts`);
});
