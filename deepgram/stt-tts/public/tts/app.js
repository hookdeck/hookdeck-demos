function renderRequest(req) {
  return `
    <div class="request-header">
      <strong>ID: ${req.id}</strong>
      <span class="status ${req.status}">${req.status.toUpperCase()}</span>
    </div>
    <div class="request-text">"${req.text}"</div>
    <div class="request-meta">Model: ${req.model} | Created: ${new Date(req.createdAt).toLocaleString()}</div>
    ${req.status === 'completed' && req.audioFile ? `
      <audio controls src="/tts/audio/${req.audioFile}"></audio>
    ` : ''}
    ${req.status === 'failed' && req.error ? `
      <div class="error">Error: ${req.error}</div>
    ` : ''}
  `;
}

// Load and display all TTS requests. Items are updated in place by ID, and
// only when their status changes, so an <audio> element that is playing is
// never replaced by the 3-second refresh.
async function loadRequests() {
  try {
    const response = await fetch('/tts/api/requests');
    const requests = await response.json();

    const listEl = document.getElementById('requestsList');
    if (requests.length === 0) {
      listEl.innerHTML = '<p style="color: #888;">No requests yet.</p>';
      return;
    }
    listEl.querySelector('p')?.remove();

    requests.forEach((req, index) => {
      let item = listEl.querySelector(`[data-id="${req.id}"]`);
      if (!item) {
        item = document.createElement('div');
        item.className = 'request-item';
        item.dataset.id = req.id;
      }
      if (item.dataset.status !== req.status) {
        item.dataset.status = req.status;
        item.innerHTML = renderRequest(req);
      }
      // Most recent first
      if (listEl.children[index] !== item) {
        listEl.insertBefore(item, listEl.children[index] || null);
      }
    });
  } catch (error) {
    console.error('Error loading requests:', error);
  }
}

// Handle form submission
document.getElementById('ttsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const messageEl = document.getElementById('message');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  
  submitBtn.disabled = true;
  messageEl.innerHTML = '';
  
  const formData = {
    text: document.getElementById('text').value,
    model: document.getElementById('model').value
  };
  
  try {
    const response = await fetch('/tts/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      messageEl.innerHTML = `<div class="success">✅ Request submitted! ID: ${result.requestId}</div>`;
      setTimeout(() => loadRequests(), 1000);
    } else {
      messageEl.innerHTML = `<div class="error">❌ Error: ${result.error}</div>`;
    }
  } catch (error) {
    messageEl.innerHTML = `<div class="error">❌ Error: ${error.message}</div>`;
  } finally {
    submitBtn.disabled = false;
  }
});

// Load requests on page load
loadRequests();

// Refresh every 3 seconds to show updated statuses
setInterval(loadRequests, 3000);
