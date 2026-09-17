// Shared settings/cache schema + storage helpers for the service worker.

export const DEFAULT_TOPICS = [
  {
    id: 'work',
    name: 'Work',
    description: 'Meetings, deadlines, projects, colleagues, calendar invites.',
    color: '#4f46e5',
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Bills, invoices, receipts, bank or payment notifications.',
    color: '#0f9d58',
  },
  {
    id: 'travel',
    name: 'Travel',
    description: 'Flights, hotels, bookings, itineraries.',
    color: '#f4834f',
  },
  {
    id: 'personal',
    name: 'Personal',
    description: 'Messages from friends, family, or personal matters.',
    color: '#d33aa3',
  },
];

export const DEFAULT_SETTINGS = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-3.8-flash',
  topics: DEFAULT_TOPICS,
  gmailQuery: 'in:inbox (is:important OR is:starred) newer_than:3d',
  maxEmails: 20,
  refreshIntervalMinutes: 15,
};

export const DEFAULT_CACHE = {
  lastUpdated: 0,
  byTopic: {},
  error: null,
  loading: false,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getCache() {
  const { cache } = await chrome.storage.local.get('cache');
  return { ...DEFAULT_CACHE, ...(cache || {}) };
}

export async function setCache(partial) {
  const current = await getCache();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ cache: next });
  return next;
}

export async function getAuthState() {
  const { auth } = await chrome.storage.local.get('auth');
  return { connected: false, ...(auth || {}) };
}

export async function setAuthState(partial) {
  const current = await getAuthState();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ auth: next });
  return next;
}
