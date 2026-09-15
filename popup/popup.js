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

function relativeTime(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function setHidden(id, hidden) {
  document.getElementById(id).classList.toggle('hidden', hidden);
}

function render(state) {
  const { settings, cache, auth } = state;
  const statusEl = document.getElementById('auth-status');
  const metaEl = document.getElementById('meta');

  if (!auth?.connected) {
    statusEl.textContent = 'Not connected';
    statusEl.className = 'status-pill status-disconnected';
    metaEl.textContent = '';
    setHidden('connect-block', false);
    setHidden('topics-block', true);
    setHidden('error-block', true);
    return;
  }

  statusEl.textContent = 'Connected';
  statusEl.className = 'status-pill status-connected';
  setHidden('connect-block', true);

  if (cache?.error) {
    document.getElementById('error-text').textContent = cache.error;
    setHidden('error-block', false);
    setHidden('topics-block', true);
    metaEl.textContent = '';
    return;
  }
  setHidden('error-block', true);

  metaEl.textContent = cache?.loading ? 'Refreshing…' : cache?.lastUpdated ? `Updated ${relativeTime(cache.lastUpdated)}` : '';

  const topics = [...(settings?.topics || []), { id: 'other', name: 'Other', color: '#5f6368' }];
  const rows = topics
    .map((t) => ({ ...t, count: (cache?.byTopic?.[t.id] || []).length }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const list = document.getElementById('topics-summary');
  list.innerHTML = '';
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.textContent = cache?.loading ? 'Reading your inbox…' : 'No important emails right now.';
    list.appendChild(li);
  } else {
    for (const t of rows) {
      const li = document.createElement('li');
      li.style.setProperty('--topic-color', t.color || '#5f6368');
      const name = document.createElement('span');
      name.textContent = t.name;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(t.count);
      li.append(name, count);
      list.appendChild(li);
    }
  }
  setHidden('topics-block', false);
}

async function load() {
  const res = await sendMessage({ type: 'GET_STATE' });
  if (!res || res.error) return;
  render(res);
}

document.getElementById('connect-btn').addEventListener('click', async () => {
  const res = await sendMessage({ type: 'CONNECT_GMAIL' });
  if (res?.error) {
    document.getElementById('error-text').textContent = res.error;
    setHidden('error-block', false);
    return;
  }
  await load();
});

document.getElementById('refresh-btn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Refreshing…';
  const res = await sendMessage({ type: 'FORCE_REFRESH' });
  if (res && !res.error) render(res);
  e.target.disabled = false;
  e.target.textContent = 'Refresh';
});

document.getElementById('open-gmail-btn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/' });
  }
  window.close();
});

document.getElementById('settings-btn').addEventListener('click', async () => {
  await sendMessage({ type: 'OPEN_OPTIONS' });
  window.close();
});

load();
