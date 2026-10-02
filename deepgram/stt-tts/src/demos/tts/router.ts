import express, { Request, Response, Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const router: Router = express.Router();

// Directories for storage
const AUDIO_DIR = path.join(__dirname, '../../../data/tts/audio');
const DATA_FILE = path.join(__dirname, '../../../data/tts/requests.json');

// Ensure directories exist
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

// Types
interface TTSRequest {
  id: string;
  text: string;
  model: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  audioFile?: string;
  error?: string;
}

// Load/Save persistence
function loadRequests(): TTSRequest[] {
  if (!fs.existsSync(DATA_FILE)) {
    return [];
  }
  const data = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(data);
}

function saveRequests(requests: TTSRequest[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2));
}

// Serve TTS UI
router.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../../public/tts/index.html'));
});

// Serve audio files
router.use('/audio', express.static(AUDIO_DIR));

// API: Get all TTS requests
router.get('/api/requests', (req: Request, res: Response) => {
  const requests = loadRequests();
  res.json(requests.reverse()); // Most recent first
});

// API: Generate TTS (using callback approach)
router.post('/api/generate', async (req: Request, res: Response) => {
  const { text, model = 'aura-asteria-en' } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
  const CALLBACK_URL = process.env.TTS_CALLBACK_URL;
  const requestId = uuidv4();
  const newRequest: TTSRequest = {
    id: requestId,
    text,
    model,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  // Save request
  const requests = loadRequests();
  requests.push(newRequest);
  saveRequests(requests);

  console.log(`📤 [TTS] Generating speech for request ${requestId}`);

  // Call Deepgram API with callback parameter
  try {
    // Hookdeck ingests binary bodies for application/octet-stream, application/pdf,
    // image/* and multipart/form-data. Deepgram sends audio/mpeg, so the
    // x-hookdeck-content-type override tells Hookdeck to treat it as octet-stream.
    const callbackUrl = `${CALLBACK_URL}?requestId=${requestId}&x-hookdeck-content-type=application/octet-stream`;
    const deepgramUrl = `https://api.deepgram.com/v1/speak?model=${model}&encoding=mp3&callback=${encodeURIComponent(callbackUrl)}`;
    
    console.log(`🔗 [TTS] Calling Deepgram API with callback:`);
    console.log(`   URL: ${deepgramUrl}`);
    console.log(`   Model: ${model}`);
    console.log(`   Callback: ${callbackUrl}`);
    console.log(`   Text length: ${text.length} characters`);
    
    const response = await fetch(deepgramUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    console.log(`📡 [TTS] Deepgram API Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [TTS] Deepgram API Error Response: ${errorText}`);
      throw new Error(`Deepgram API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    console.log(`✅ [TTS] TTS request accepted by Deepgram for ${requestId}`);
    console.log(`⏳ [TTS] Waiting for callback with audio data...`);

    res.json({
      success: true,
      requestId,
      message: 'TTS request accepted. Waiting for callback...'
    });

  } catch (error) {
    console.error(`❌ [TTS] Error generating speech:`, error);
    
    // Update request status
    const updatedRequests = loadRequests();
    const reqIndex = updatedRequests.findIndex(r => r.id === requestId);
    if (reqIndex !== -1) {
      updatedRequests[reqIndex].status = 'failed';
      updatedRequests[reqIndex].error = error instanceof Error ? error.message : String(error);
      saveRequests(updatedRequests);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate TTS'
    });
  }
});

// Webhook endpoint to receive callback from Deepgram (via Hookdeck)
// Deepgram POSTs the generated audio as the raw request body (audio/mpeg).
// Hookdeck forwards it byte-exact, as application/octet-stream because of the
// content-type override on the callback URL, so the body is the MP3 file.
const AUDIO_EXTENSIONS: { [contentType: string]: string } = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/flac': '.flac',
  'audio/aac': '.aac',
};

router.post('/webhook', express.raw({ type: '*/*', limit: '10mb' }), async (req: Request, res: Response) => {
  const requestId = req.query.requestId as string;
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  console.log(`📥 [TTS Webhook] Received callback for request ${requestId}`);
  console.log(`   Content-Type: ${contentType || 'none'}`);

  if (!requestId) {
    console.error('❌ [TTS Webhook] No requestId in callback');
    return res.status(400).json({ error: 'Missing requestId' });
  }

  const updatedRequests = loadRequests();
  const reqIndex = updatedRequests.findIndex(r => r.id === requestId);

  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new Error(`Expected a binary audio body, got ${contentType || 'no content type'}`);
    }

    const filename = `${requestId}${AUDIO_EXTENSIONS[contentType] || '.mp3'}`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), req.body);

    console.log(`   Audio size: ${req.body.length} bytes`);
    console.log(`✅ [TTS Webhook] Audio saved as ${filename}`);

    if (reqIndex !== -1) {
      updatedRequests[reqIndex].status = 'completed';
      updatedRequests[reqIndex].completedAt = new Date().toISOString();
      updatedRequests[reqIndex].audioFile = filename;
      saveRequests(updatedRequests);
    } else {
      console.warn(`⚠️  [TTS Webhook] Request ${requestId} not found in database`);
    }

    res.status(200).json({ received: true, requestId, bytes: req.body.length });
  } catch (error) {
    console.error(`❌ [TTS Webhook] Error processing callback:`, error);

    if (reqIndex !== -1) {
      updatedRequests[reqIndex].status = 'failed';
      updatedRequests[reqIndex].error = error instanceof Error ? error.message : String(error);
      saveRequests(updatedRequests);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to process callback'
    });
  }
});

export default router;
