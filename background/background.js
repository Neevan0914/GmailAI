import {
  getSettings,
  setSettings,
  getCache,
  setCache,
  getAuthState,
  setAuthState,
  DEFAULT_CACHE,
} from './storage.js';
import { fetchImportantEmails, ensureGmailConnected, disconnectGmail, AuthError } from './gmail.js';
import { categorizeAndSummarize, testApiKey } from './ai.js';

const ALARM_NAME = 'gmailai-refresh';
const STALE_MS = 10 * 60 * 1000;

let refreshInFlight = null;

function groupByTopic(emails, results, topics) {
  const resultById = new Map(results.map((r) => [r.id, r]));
  const grouped = {};
  for (const id of [...topics.map((t) => t.id), 'other']) grouped[id] = [];

  for (const email of emails) {
    const r = resultById.get(email.id);
    const topic = r && grouped[r.topic] ? r.topic : 'other';
    grouped[topic].push({
      id: email.id,
      threadId: email.threadId,
      subject: email.subject,
      from: email.from,
      date: email.date,
      summary: r?.summary || email.snippet,
      priority: r?.priority || 'normal',
    });
  }

  const priorityRank = { high: 0, normal: 1, low: 2 };
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => {
      if (priorityRank[a.priority] !== priorityRank[b.priority]) {
        return priorityRank[a.priority] - priorityRank[b.priority];
      }
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }
  return grouped;
}

async function broadcastState() {
  const [settings, cache, auth] = await Promise.all([getSettings(), getCache(), getAuthState()]);
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  for (const tab of tabs) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'SUMMARIES_UPDATED', payload: { settings, cache, auth } })
      .catch(() => {});
  }
}

async function runRefresh() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    await setCache({ loading: true, error: null });
    broadcastState();
    try {
      const settings = await getSettings();
      const emails = await fetchImportantEmails(settings);
      const results = await categorizeAndSummarize(emails, settings);
      const byTopic = groupByTopic(emails, results, settings.topics);
      await setAuthState({ connected: true });
      await setCache({ loading: false, error: null, lastUpdated: Date.now(), byTopic });
    } catch (err) {
      if (err instanceof AuthError) {
        await setAuthState({ connected: false });
        await setCache({ loading: false, error: null });
      } else {
        await setCache({ loading: false, error: err?.message || String(err) });
      }
    } finally {
      broadcastState();
    }
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function getFullState() {
  const [settings, cache, auth] = await Promise.all([getSettings(), getCache(), getAuthState()]);
  return { settings, cache, auth };
}

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATE': {
      const state = await getFullState();
      const stale = Date.now() - (state.cache.lastUpdated || 0) > STALE_MS;
      if (state.auth.connected && !state.cache.loading && stale) {
        runRefresh();
      }
      return state;
    }
    case 'FORCE_REFRESH': {
      await runRefresh();
      return getFullState();
    }
    case 'CONNECT_GMAIL': {
      await ensureGmailConnected();
      await setAuthState({ connected: true });
      runRefresh();
      return { ok: true };
    }
    case 'DISCONNECT_GMAIL': {
      await disconnectGmail();
      await setAuthState({ connected: false });
      await setCache(DEFAULT_CACHE);
      return { ok: true };
    }
    case 'OPEN_OPTIONS': {
      chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    case 'TEST_API_KEY': {
      await testApiKey(message.settings);
      return { ok: true };
    }
    case 'SAVE_SETTINGS': {
      const next = await setSettings(message.settings);
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: next.refreshIntervalMinutes || 15 });
      return { settings: next };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err?.message || String(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await setSettings(await getSettings());
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshIntervalMinutes || 15 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runRefresh();
  }
});
