// Gmail API access: OAuth via chrome.identity + minimal REST client.

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const BODY_EXCERPT_LIMIT = 1500;
const CONCURRENCY = 5;

class AuthError extends Error {}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new AuthError(chrome.runtime.lastError?.message || 'No auth token available.'));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

export async function disconnectGmail() {
  try {
    const token = await getAuthToken(false);
    await removeCachedToken(token);
  } catch (err) {
    // Nothing cached, nothing to do.
  }
}

async function gmailFetch(path, { interactive = false } = {}) {
  let token = await getAuthToken(interactive);
  let res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    await removeCachedToken(token);
    token = await getAuthToken(interactive);
    res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function ensureGmailConnected() {
  await getAuthToken(true);
}

function decodeBase64Url(data) {
  if (!data) return '';
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function stripHtml(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findBodyInParts(part, preferred) {
  if (!part) return null;
  if (part.mimeType === preferred && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = findBodyInParts(child, preferred);
      if (found) return found;
    }
  }
  return null;
}

function extractBody(payload) {
  if (!payload) return '';
  const plain = findBodyInParts(payload, 'text/plain');
  if (plain) return plain;
  const html = findBodyInParts(payload, 'text/html');
  if (html) return stripHtml(html);
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function fetchImportantEmails({ gmailQuery, maxEmails }) {
  const listRes = await gmailFetch(
    `/messages?q=${encodeURIComponent(gmailQuery)}&maxResults=${encodeURIComponent(maxEmails)}`
  );
  const ids = (listRes.messages || []).map((m) => m.id);
  if (ids.length === 0) return [];

  const messages = await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
    const msg = await gmailFetch(`/messages/${id}?format=full`);
    const headers = msg.payload?.headers || [];
    const body = extractBody(msg.payload);
    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: getHeader(headers, 'Subject') || '(no subject)',
      from: getHeader(headers, 'From'),
      date: getHeader(headers, 'Date'),
      snippet: msg.snippet || '',
      bodyExcerpt: (body || msg.snippet || '').slice(0, BODY_EXCERPT_LIMIT),
    };
  });

  return messages;
}

export { AuthError };
