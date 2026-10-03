const BADGES = { completed: 'badge--success', failed: 'badge--danger', pending: 'badge--warning' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderRequest(req) {
  return `
    <div class="request-head">
      <span class="badge ${BADGES[req.status] || ''}">${esc(req.status)}</span>
      <span class="request-meta body-xs"><span>${new Date(req.createdAt).toLocaleString()}</span></span>
    </div>
    <div class="request-text body-s">“${esc(req.text)}”</div>
    ${req.status === 'completed' && req.audioFile ? `<audio controls src="/tts/audio/${esc(req.audioFile)}"></audio>` : ''}
    ${req.status === 'failed' && req.error ? `<div class="error body-xs">${esc(req.error)}</div>` : ''}
    <div class="request-meta body-xs">
      <span>Model <code>${esc(req.model)}</code></span>
      <span>ID <code>${esc(req.id)}</code></span>
    </div>
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
      listEl.innerHTML = '<p class="empty body-s">No requests yet.</p>';
      return;
    }
    listEl.querySelector('.empty')?.remove();

    requests.forEach((req, index) => {
      let item = listEl.querySelector(`[data-id="${req.id}"]`);
      if (!item) {
        item = document.createElement('div');
        item.className = 'request';
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

function showMessage(text, type) {
  const messageEl = document.getElementById('message');
  messageEl.textContent = text;
  messageEl.className = `message body-s ${type || ''}`;
}

// Handle form submission
document.getElementById('ttsForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  showMessage('', '');

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
      showMessage(`Request submitted (${result.requestId}). Waiting for the audio callback…`, 'success');
      setTimeout(() => loadRequests(), 1000);
    } else {
      showMessage(`Error: ${result.error}`, 'error');
    }
  } catch (error) {
    showMessage(`Error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// Load requests on page load
loadRequests();

// Refresh every 3 seconds to show updated statuses
setInterval(loadRequests, 3000);
