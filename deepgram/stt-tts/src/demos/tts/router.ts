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
    const deepgramUrl = `https://api.deepgram.com/v1/speak?model=${model}&encoding=mp3&callback=${encodeURIComponent(CALLBACK_URL + '?requestId=' + requestId)}`;
    
    console.log(`🔗 [TTS] Calling Deepgram API with callback:`);
    console.log(`   URL: ${deepgramUrl}`);
    console.log(`   Model: ${model}`);
    console.log(`   Callback: ${CALLBACK_URL}?requestId=${requestId}`);
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
// ⚠️ NOTE: This endpoint will NEVER be called because Hookdeck rejects binary data.
// Deepgram sends binary audio data (audio/mpeg) in callbacks, but Hookdeck only
// supports JSON webhooks and will reject the request from Deepgram.
// This is left here for demonstration purposes.
router.post('/webhook', async (req: Request, res: Response) => {
  const requestId = req.query.requestId as string;
  
  console.log(`📥 [TTS Webhook] Received callback for request ${requestId}`);
  console.log(`   Content-Type: ${req.headers['content-type']}`);
  console.log(`   Body type: ${typeof req.body}`);
  console.log(`   ⚠️  NOTE: This should never be called - Hookdeck rejects binary data`);
  
  if (!requestId) {
    console.error('❌ [TTS Webhook] No requestId in callback');
    return res.status(400).json({ error: 'Missing requestId' });
  }

  try {
    // ⚠️ LIMITATION: Hookdeck rejects binary audio data from Deepgram
    // This endpoint will never receive the callback because Hookdeck rejects
    // the request when Deepgram tries to send binary audio/mpeg content
    
    const filename = `${requestId}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);
    
    // This would work if we received the audio data directly (without Hookdeck):
    // fs.writeFileSync(filepath, req.body);
    
    console.log(`❌ [TTS Webhook] This endpoint should not be reachable`);
    console.log(`   Hookdeck rejects binary audio/mpeg content from Deepgram`);
    
    // Update request status
    const updatedRequests = loadRequests();
    const reqIndex = updatedRequests.findIndex(r => r.id === requestId);
    if (reqIndex !== -1) {
      updatedRequests[reqIndex].status = 'failed';
      updatedRequests[reqIndex].error = 'Hookdeck rejected binary audio/mpeg content';
      saveRequests(updatedRequests);
    }

    res.status(200).json({ received: true, limitation: 'Hookdeck rejects binary audio' });
  } catch (error) {
    console.error(`❌ [TTS Webhook] Error processing callback:`, error);
    
    const updatedRequests = loadRequests();
    const reqIndex = updatedRequests.findIndex(r => r.id === requestId);
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
