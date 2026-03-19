// Audio recording state
let mediaRecorder = null;
let audioChunks = [];
let recordedBlob = null;
let autoRefreshInterval = null;

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
      audioPreview.style.display = 'block';
      clearBtn.disabled = false;
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      recorderStatus.textContent = 'Recording stopped. You can now upload and transcribe.';
      recorderStatus.className = 'status-message success';
    };
    
    // Start recording
    mediaRecorder.start();
    
    // Update UI
    startBtn.disabled = true;
    stopBtn.disabled = false;
    recorderStatus.textContent = '🔴 Recording... Click "Stop Recording" when done.';
    recorderStatus.className = 'status-message recording';
    
  } catch (error) {
    console.error('Error accessing microphone:', error);
    showMessage(`Error: ${error.message}`, 'error');
    recorderStatus.textContent = 'Error accessing microphone. Please grant permission.';
    recorderStatus.className = 'status-message error';
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
  recorderStatus.textContent = 'Ready to record. Click "Start Recording" to begin.';
  recorderStatus.className = 'status-message';
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
    
    showMessage(
      `✅ Transcription started! Request ID: ${requestId}. Waiting for callback...`,
      'success'
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
    requestsList.innerHTML = `<div class="error">Error loading requests: ${error.message}</div>`;
  }
}

// Display requests
function displayRequests(requests) {
  if (requests.length === 0) {
    requestsList.innerHTML = '<p>No transcription requests yet. Record and upload audio to get started!</p>';
    return;
  }
  
  requestsList.innerHTML = requests.map(req => {
    const statusClass = req.status === 'completed' ? 'completed' : 
                       req.status === 'failed' ? 'failed' : 'pending';
    
    let statusBadge = `<span class="status ${statusClass}">${req.status.toUpperCase()}</span>`;
    
    let transcriptionHtml = '';
    if (req.status === 'completed' && req.transcription) {
      transcriptionHtml = `
        <div class="transcription">
          <strong>Transcription:</strong>
          <p>${escapeHtml(req.transcription)}</p>
        </div>
      `;
    }
    
    let errorHtml = '';
    if (req.status === 'failed' && req.error) {
      errorHtml = `<div class="error">Error: ${escapeHtml(req.error)}</div>`;
    }
    
    let metaInfo = `<div class="request-meta">`;
    metaInfo += `ID: ${req.id}<br>`;
    metaInfo += `Created: ${new Date(req.createdAt).toLocaleString()}<br>`;
    if (req.model) metaInfo += `Model: ${req.model}<br>`;
    if (req.duration) metaInfo += `Duration: ${req.duration.toFixed(2)}s<br>`;
    if (req.completedAt) metaInfo += `Completed: ${new Date(req.completedAt).toLocaleString()}`;
    metaInfo += `</div>`;
    
    let audioHtml = '';
    if (req.filename) {
      audioHtml = `
        <div class="audio-playback">
          <audio controls src="/stt/audio/${req.filename}"></audio>
        </div>
      `;
    }
    
    return `
      <div class="request-item">
        <div class="request-header">
          ${statusBadge}
          <span class="request-date">${new Date(req.createdAt).toLocaleString()}</span>
        </div>
        ${transcriptionHtml}
        ${audioHtml}
        ${errorHtml}
        ${metaInfo}
      </div>
    `;
  }).join('');
}

// Auto-refresh functionality
function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval
  autoRefreshInterval = setInterval(async () => {
    // Only auto-refresh if there are pending requests
    const response = await fetch('/stt/api/requests');
    if (response.ok) {
      const requests = await response.json();
      const hasPending = requests.some(r => r.status === 'pending');
      if (hasPending) {
        await loadRequests();
      }
    }
  }, 3000);
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
  messageDiv.className = type;
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
