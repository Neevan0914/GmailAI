const FALLBACK = {
  model: 'claude-haiku-4-5-20251001',
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-3.8-flash',
  gmailQuery: 'in:inbox (is:important OR is:starred) newer_than:3d',
  maxEmails: 20,
  refreshIntervalMinutes: 15,
};

const state = { settings: null, auth: null };

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res);
    });
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomColor() {
  const palette = ['#4f46e5', '#0f9d58', '#f4834f', '#d33aa3', '#00b8d9', '#e64a19', '#3949ab', '#00897b'];
  return palette[Math.floor(Math.random() * palette.length)];
}

function setStatus(elId, text, isError) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.style.color = isError ? '#c5221f' : '';
}

function renderAuth() {
  const statusEl = document.getElementById('auth-status');
  const connectBtn = document.getElementById('connect-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  if (state.auth?.connected) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status-pill status-connected';
    connectBtn.hidden = true;
    disconnectBtn.hidden = false;
  } else {
    statusEl.textContent = 'Not connected';
    statusEl.className = 'status-pill status-disconnected';
    connectBtn.hidden = false;
    disconnectBtn.hidden = true;
  }
}

function renderProvider() {
  const { settings } = state;
  document.getElementById('provider-select').value = settings.provider;
  document.getElementById('api-key-input').value = settings.apiKey || '';
  document.getElementById('anthropic-model-input').value = settings.model || '';
  document.getElementById('anthropic-model-input').placeholder = FALLBACK.model;
  document.getElementById('openai-model-input').value = settings.openaiModel || '';
  document.getElementById('openai-model-input').placeholder = FALLBACK.openaiModel;
  document.getElementById('gemini-model-input').value = settings.geminiModel || '';
  document.getElementById('gemini-model-input').placeholder = FALLBACK.geminiModel;
  toggleProviderFields();
}

function toggleProviderFields() {
  const provider = document.getElementById('provider-select').value;
  document.querySelector('.anthropic-only').classList.toggle('hidden', provider !== 'anthropic');
  document.querySelector('.openai-only').classList.toggle('hidden', provider !== 'openai');
  document.querySelector('.gemini-only').classList.toggle('hidden', provider !== 'gemini');
}

function renderTopics() {
  const list = document.getElementById('topics-list');
  list.innerHTML = '';
  state.settings.topics.forEach((topic, index) => {
    const row = document.createElement('div');
    row.className = 'topic-row';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = topic.color || '#4f46e5';
    colorInput.addEventListener('input', (e) => {
      topic.color = e.target.value;
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Topic name (e.g. Swimming)';
    nameInput.value = topic.name || '';
    nameInput.addEventListener('input', (e) => {
      topic.name = e.target.value;
    });

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.placeholder = 'What belongs here? (helps the AI classify)';
    descInput.value = topic.description || '';
    descInput.addEventListener('input', (e) => {
      topic.description = e.target.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-topic-btn';
    removeBtn.setAttribute('aria-label', 'Remove topic');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      state.settings.topics.splice(index, 1);
      renderTopics();
    });

    row.append(colorInput, nameInput, descInput, removeBtn);
    list.appendChild(row);
  });
}

function renderScanSettings() {
  const { settings } = state;
  document.getElementById('gmail-query-input').value = settings.gmailQuery || '';
  document.getElementById('gmail-query-input').placeholder = FALLBACK.gmailQuery;
  document.getElementById('max-emails-input').value = settings.maxEmails ?? FALLBACK.maxEmails;
  document.getElementById('refresh-interval-input').value =
    settings.refreshIntervalMinutes ?? FALLBACK.refreshIntervalMinutes;
}

function render() {
  renderAuth();
  renderProvider();
  renderTopics();
  renderScanSettings();
}

async function load() {
  const res = await sendMessage({ type: 'GET_STATE' });
  if (res?.error) {
    setStatus('save-status', `Failed to load settings: ${res.error}`, true);
    return;
  }
  state.settings = res.settings;
  state.auth = res.auth;
  render();
}

function wireEvents() {
  document.getElementById('provider-select').addEventListener('change', toggleProviderFields);

  document.getElementById('toggle-key-visibility').addEventListener('click', (e) => {
    const input = document.getElementById('api-key-input');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    e.target.textContent = showing ? 'Show' : 'Hide';
  });

  document.getElementById('connect-btn').addEventListener('click', async () => {
    setStatus('save-status', 'Connecting to Google…');
    const res = await sendMessage({ type: 'CONNECT_GMAIL' });
    if (res?.error) {
      setStatus('save-status', `Connection failed: ${res.error}`, true);
      return;
    }
    setStatus('save-status', 'Connected.');
    await load();
  });

  document.getElementById('disconnect-btn').addEventListener('click', async () => {
    await sendMessage({ type: 'DISCONNECT_GMAIL' });
    setStatus('save-status', 'Disconnected.');
    await load();
  });

  document.getElementById('test-key-btn').addEventListener('click', async () => {
    const settings = {
      provider: document.getElementById('provider-select').value,
      apiKey: document.getElementById('api-key-input').value.trim(),
    };
    if (!settings.apiKey) {
      setStatus('test-key-result', 'Enter an API key first.', true);
      return;
    }
    setStatus('test-key-result', 'Testing…');
    const res = await sendMessage({ type: 'TEST_API_KEY', settings });
    if (res?.error) setStatus('test-key-result', `Failed: ${res.error}`, true);
    else setStatus('test-key-result', 'Key looks good.');
  });

  document.getElementById('add-topic-btn').addEventListener('click', () => {
    state.settings.topics.push({
      id: `topic-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      description: '',
      color: randomColor(),
    });
    renderTopics();
  });

  document.getElementById('refresh-now-btn').addEventListener('click', async () => {
    setStatus('refresh-now-result', 'Refreshing…');
    const res = await sendMessage({ type: 'FORCE_REFRESH' });
    if (res?.error) {
      setStatus('refresh-now-result', `Failed: ${res.error}`, true);
      return;
    }
    if (res?.cache?.error) {
      setStatus('refresh-now-result', `Failed: ${res.cache.error}`, true);
      return;
    }
    const count = Object.values(res?.cache?.byTopic || {}).reduce((sum, arr) => sum + arr.length, 0);
    setStatus('refresh-now-result', `Done — ${count} email(s) summarized.`);
  });

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    state.settings.provider = document.getElementById('provider-select').value;
    state.settings.apiKey = document.getElementById('api-key-input').value.trim();
    state.settings.model = document.getElementById('anthropic-model-input').value.trim() || FALLBACK.model;
    state.settings.openaiModel =
      document.getElementById('openai-model-input').value.trim() || FALLBACK.openaiModel;
    state.settings.geminiModel =
      document.getElementById('gemini-model-input').value.trim() || FALLBACK.geminiModel;
    state.settings.gmailQuery = document.getElementById('gmail-query-input').value.trim() || FALLBACK.gmailQuery;
    state.settings.maxEmails = clamp(
      parseInt(document.getElementById('max-emails-input').value, 10) || FALLBACK.maxEmails,
      1,
      50
    );
    state.settings.refreshIntervalMinutes = clamp(
      parseInt(document.getElementById('refresh-interval-input').value, 10) || FALLBACK.refreshIntervalMinutes,
      5,
      180
    );
    state.settings.topics = state.settings.topics
      .map((t) => ({ ...t, name: t.name.trim(), description: t.description.trim() }))
      .filter((t) => t.name.length > 0);

    setStatus('save-status', 'Saving…');
    const res = await sendMessage({ type: 'SAVE_SETTINGS', settings: state.settings });
    if (res?.error) {
      setStatus('save-status', `Error: ${res.error}`, true);
      return;
    }
    state.settings = res.settings;
    render();
    setStatus('save-status', 'Saved.');
  });
}

wireEvents();
load();
