import express, { Request, Response, Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';

const router: Router = express.Router();

// Directories for storage
const AUDIO_DIR = path.join(__dirname, '../../../data/stt/audio');
const DATA_FILE = path.join(__dirname, '../../../data/stt/requests.json');

// Ensure directories exist
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

// Configure multer for audio uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AUDIO_DIR);
  },
  filename: (req, file, cb) => {
    const requestId = uuidv4();
    const ext = path.extname(file.originalname) || '.webm';
    req.body.requestId = requestId; // Store for later use
    cb(null, `${requestId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});

// Types
interface STTRequest {
  id: string;
  filename: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  transcription?: string;
  error?: string;
  duration?: number;
  model?: string;
}

// Load/Save persistence
function loadRequests(): STTRequest[] {
  if (!fs.existsSync(DATA_FILE)) {
    return [];
  }
  const data = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(data);
}

function saveRequests(requests: STTRequest[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2));
}

// Serve STT UI
router.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../../public/stt/index.html'));
});

// Serve audio files
router.use('/audio', express.static(AUDIO_DIR));

// API: Get all STT requests
router.get('/api/requests', (req: Request, res: Response) => {
  const requests = loadRequests();
  res.json(requests.reverse()); // Most recent first
});

// API: Upload audio file
router.post('/api/upload', upload.single('audio'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const requestId = path.basename(req.file.filename, path.extname(req.file.filename));
  const newRequest: STTRequest = {
    id: requestId,
    filename: req.file.filename,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  // Save request
  const requests = loadRequests();
  requests.push(newRequest);
  saveRequests(requests);

  console.log(`📤 [STT] Audio uploaded: ${requestId} (${req.file.size} bytes)`);

  res.json({
    success: true,
    requestId,
    filename: req.file.filename,
    message: 'Audio uploaded successfully. Call /api/transcribe to start transcription.'
  });
});

// API: Transcribe audio (calls Deepgram with callback)
router.post('/api/transcribe', async (req: Request, res: Response) => {
  const { requestId, model = 'nova-2' } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' });
  }

  const requests = loadRequests();
  const request = requests.find(r => r.id === requestId);

  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
  const STT_CALLBACK_URL = process.env.STT_CALLBACK_URL;

  if (!DEEPGRAM_API_KEY || !STT_CALLBACK_URL) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const audioPath = path.join(AUDIO_DIR, request.filename);

  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  console.log(`📤 [STT] Starting transcription for ${requestId}`);

  try {
    // Read audio file
    const audioBuffer = fs.readFileSync(audioPath);
    
    // Determine content type from file extension
    const ext = path.extname(request.filename).toLowerCase();
    const contentTypeMap: { [key: string]: string } = {
      '.webm': 'audio/webm',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
    };
    const contentType = contentTypeMap[ext] || 'audio/webm';

    // Build Deepgram API URL with callback
    const deepgramUrl = `https://api.deepgram.com/v1/listen?` + 
      `callback=${encodeURIComponent(STT_CALLBACK_URL + '?requestId=' + requestId)}&` +
      `model=${model}&` +
      `punctuate=true&` +
      `smart_format=true`;

    console.log(`🔗 [STT] Calling Deepgram API with callback:`);
    console.log(`   URL: ${deepgramUrl}`);
    console.log(`   Model: ${model}`);
    console.log(`   Callback: ${STT_CALLBACK_URL}?requestId=${requestId}`);
    console.log(`   Audio size: ${audioBuffer.length} bytes`);
    console.log(`   Content-Type: ${contentType}`);

    // Call Deepgram API
    const response = await fetch(deepgramUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': contentType,
      },
      body: audioBuffer,
    });

    console.log(`📡 [STT] Deepgram API Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [STT] Deepgram API Error: ${errorText}`);
      throw new Error(`Deepgram API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ [STT] Transcription request accepted`);
    console.log(`   Request ID from Deepgram: ${result.request_id || 'N/A'}`);
    console.log(`⏳ [STT] Waiting for callback with transcription...`);

    // Update request to show it's processing
    const updatedRequests = loadRequests();
    const reqIndex = updatedRequests.findIndex(r => r.id === requestId);
    if (reqIndex !== -1) {
      updatedRequests[reqIndex].model = model;
      saveRequests(updatedRequests);
    }

    res.json({
      success: true,
      requestId,
      message: 'Transcription started. Waiting for callback...',
      deepgramRequestId: result.request_id
    });

  } catch (error) {
    console.error(`❌ [STT] Error starting transcription:`, error);

    // Update request status
    const updatedRequests = loadRequests();
    const reqIndex = updatedRequests.findIndex(r => r.id === requestId);
    if (reqIndex !== -1) {
      updatedRequests[reqIndex].status = 'failed';
      updatedRequests[reqIndex].error = error instanceof Error ? error.message : String(error);
      saveRequests(updatedRequests);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start transcription'
    });
  }
});

// Webhook endpoint to receive transcription results from Deepgram (via Hookdeck)
router.post('/webhook', express.json(), async (req: Request, res: Response) => {
  const requestId = req.query.requestId as string;

  console.log(`📥 [STT Webhook] Received callback for request ${requestId}`);
  console.log(`   Content-Type: ${req.headers['content-type']}`);

  if (!requestId) {
    console.error('❌ [STT Webhook] No requestId in callback');
    return res.status(400).json({ error: 'Missing requestId' });
  }

  try {
    // Parse Deepgram response
    const deepgramResponse = req.body;
    
    console.log(`📝 [STT Webhook] Processing transcription result`);

    // Extract transcription from Deepgram response
    // Response structure: results.channels[0].alternatives[0].transcript
    let transcription = '';
    let duration = 0;

    if (deepgramResponse.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
      transcription = deepgramResponse.results.channels[0].alternatives[0].transcript;
    }

    if (deepgramResponse.metadata?.duration) {
      duration = deepgramResponse.metadata.duration;
    }

    console.log(`   Transcription: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
    console.log(`   Duration: ${duration}s`);

    // Update request status
    const updatedRequests = loadRequests();
    const reqIndex = updatedRequests.findIndex(r => r.id === requestId);

    if (reqIndex !== -1) {
      updatedRequests[reqIndex].status = 'completed';
      updatedRequests[reqIndex].completedAt = new Date().toISOString();
      updatedRequests[reqIndex].transcription = transcription;
      updatedRequests[reqIndex].duration = duration;
      saveRequests(updatedRequests);
      
      console.log(`✅ [STT Webhook] Transcription saved for ${requestId}`);
    } else {
      console.warn(`⚠️  [STT Webhook] Request ${requestId} not found in database`);
    }

    res.status(200).json({ received: true, requestId });

  } catch (error) {
    console.error(`❌ [STT Webhook] Error processing callback:`, error);

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
