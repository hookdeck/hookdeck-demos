// Audio recording state
let mediaRecorder = null;
let audioChunks = [];
let recordedBlob = null;
let autoRefreshInterval = null;
// The request submitted from this page, so the message can follow its status
let awaitingId = null;

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const uploadBtn = document.getElementById('uploadBtn');
const refreshBtn = document.getElementById('refreshBtn');
const autoRefreshCheckbox = document.getElementById('autoRefresh');
const recorderStatus = document.getElementById('recorderStatus');
const audioPreview = document.getElementById('audioPreview');
const audioPlayer = document.getElementById('audioPlayer');
const modelSelect = document.getElementById('model');
const messageDiv = document.getElementById('message');
const requestsList = document.getElementById('requestsList');

// Start recording
startBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = () => {
      // Create blob from chunks
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      
      // Create URL for playback
      const audioUrl = URL.createObjectURL(recordedBlob);
      audioPlayer.src = audioUrl;
      
      // Show preview
      audioPreview.style.display = 'grid';
      clearBtn.disabled = false;
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      recorderStatus.textContent = 'Recording stopped. You can now upload and transcribe.';
      recorderStatus.className = 'message body-s success';
    };
    
    // Start recording
    mediaRecorder.start();
    
    // Update UI
    startBtn.disabled = true;
    stopBtn.disabled = false;
    recorderStatus.textContent = 'Recording… Click "Stop recording" when done.';
    recorderStatus.className = 'message body-s recording';
    
  } catch (error) {
    console.error('Error accessing microphone:', error);
    showMessage(`Error: ${error.message}`, 'error');
    recorderStatus.textContent = 'Error accessing microphone. Please grant permission.';
    recorderStatus.className = 'message body-s error';
  }
});

// Stop recording
stopBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

// Clear recording
clearBtn.addEventListener('click', () => {
  recordedBlob = null;
  audioChunks = [];
  audioPlayer.src = '';
  audioPreview.style.display = 'none';
  clearBtn.disabled = true;
  recorderStatus.textContent = 'Ready to record. Click "Start recording" to begin.';
  recorderStatus.className = 'message body-s info';
  showMessage('', '');
});

// Upload and transcribe
uploadBtn.addEventListener('click', async () => {
  if (!recordedBlob) {
    showMessage('No audio recorded', 'error');
    return;
  }
  
  uploadBtn.disabled = true;
  showMessage('Uploading audio...', 'info');
  
  try {
    // Step 1: Upload audio
    const formData = new FormData();
    formData.append('audio', recordedBlob, 'recording.webm');
    
    const uploadResponse = await fetch('/stt/api/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!uploadResponse.ok) {
      const error = await uploadResponse.json();
      throw new Error(error.error || 'Upload failed');
    }
    
    const uploadData = await uploadResponse.json();
    const requestId = uploadData.requestId;
    
    showMessage(`Audio uploaded. Starting transcription...`, 'info');
    
    // Step 2: Start transcription
    const transcribeResponse = await fetch('/stt/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        model: modelSelect.value
      })
    });
    
    if (!transcribeResponse.ok) {
      const error = await transcribeResponse.json();
      throw new Error(error.error || 'Transcription failed');
    }
    
    const transcribeData = await transcribeResponse.json();
    
    awaitingId = requestId;
    showMessage(
      `Transcription started (${requestId}). Waiting for the callback…`,
      'info'
    );
    
    // Refresh requests list
    await loadRequests();
    
    // Clear the recording
    clearBtn.click();
    
  } catch (error) {
    console.error('Error:', error);
    showMessage(`Error: ${error.message}`, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

// Refresh button
refreshBtn.addEventListener('click', loadRequests);

// Auto-refresh toggle
autoRefreshCheckbox.addEventListener('change', () => {
  if (autoRefreshCheckbox.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

// Load transcription requests
async function loadRequests() {
  try {
    const response = await fetch('/stt/api/requests');
    if (!response.ok) throw new Error('Failed to load requests');
    
    const requests = await response.json();
    displayRequests(requests);
    
  } catch (error) {
    console.error('Error loading requests:', error);
    requestsList.innerHTML = `<p class="error body-s">Error loading requests: ${escapeHtml(error.message)}</p>`;
  }
}

const BADGES = { completed: 'badge--success', failed: 'badge--danger', pending: 'badge--warning' };

function renderRequest(req) {
  return `
    <div class="request-head">
      <span class="badge ${BADGES[req.status] || ''}">${escapeHtml(req.status)}</span>
      <span class="request-meta body-xs"><span>${new Date(req.createdAt).toLocaleString()}</span></span>
    </div>
    ${req.status === 'completed' && req.transcription ? `<div class="request-text body-s">“${escapeHtml(req.transcription)}”</div>` : ''}
    ${req.filename ? `<audio controls src="/stt/audio/${escapeHtml(req.filename)}"></audio>` : ''}
    ${req.status === 'failed' && req.error ? `<div class="error body-xs">${escapeHtml(req.error)}</div>` : ''}
    <div class="request-meta body-xs">
      ${req.model ? `<span>Model <code>${escapeHtml(req.model)}</code></span>` : ''}
      ${req.duration ? `<span>Duration ${req.duration.toFixed(2)}s</span>` : ''}
      ${req.completedAt ? `<span>Completed ${new Date(req.completedAt).toLocaleString()}</span>` : ''}
      <span>ID <code>${escapeHtml(req.id)}</code></span>
    </div>
  `;
}

// Display requests. Items are updated in place by ID, and only when they
// change, so an <audio> element that is playing is never replaced by the
// auto-refresh.
function displayRequests(requests) {
  if (requests.length === 0) {
    requestsList.innerHTML = '<p class="empty body-s">No transcription requests yet. Record and upload audio to get started.</p>';
    return;
  }
  requestsList.querySelector('.empty, .error')?.remove();

  const awaited = requests.find((req) => req.id === awaitingId);
  if (awaited && awaited.status !== 'pending') {
    awaitingId = null;
    if (awaited.status === 'completed') showMessage('Transcription received from Deepgram via Hookdeck. See it below.', 'success');
    else showMessage(`Failed: ${awaited.error || 'unknown error'}`, 'error');
  }

  requests.forEach((req, index) => {
    let item = requestsList.querySelector(`[data-id="${req.id}"]`);
    if (!item) {
      item = document.createElement('div');
      item.className = 'request';
      item.dataset.id = req.id;
    }
    const version = `${req.status}|${req.model || ''}`;
    if (item.dataset.version !== version) {
      item.dataset.version = version;
      item.innerHTML = renderRequest(req);
    }
    // Most recent first
    if (requestsList.children[index] !== item) {
      requestsList.insertBefore(item, requestsList.children[index] || null);
    }
  });
}

// Auto-refresh functionality
function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval
  // Rows update in place, so redrawing every poll is cheap and catches the
  // poll where a pending request completes
  autoRefreshInterval = setInterval(loadRequests, 3000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Show message
function showMessage(text, type) {
  messageDiv.textContent = text;
  messageDiv.className = `message body-s ${type || ''}`;
}

// Escape HTML for safe display
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initial load
loadRequests();

// Start auto-refresh if checkbox is checked
if (autoRefreshCheckbox.checked) {
  startAutoRefresh();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});
