# Gmail AI Summarizer

A Chrome extension (Manifest V3) that reads your important Gmail messages,
summarizes them with AI, and sorts the summaries into topic tabs (e.g.
**Work**, **Swimming**, **Finance**) — all from one button that sits right
above the Compose button.

## Features

- **One button, no new tab.** An "AI Summary" button is injected directly
  above Gmail's Compose button. Clicking it opens a floating panel — nothing
  navigates away from your inbox.
- **Topic tabs.** You define topics (name + a short description of what
  belongs in it). The AI classifies each important email into exactly one
  topic and writes a 1–2 sentence summary that surfaces the most useful
  detail for *that* topic (a meeting time for Work, a pool schedule for
  Swimming, an amount due for Finance, etc.).
- **Runs on a schedule.** A background alarm refreshes summaries
  periodically so the panel is already warm when you open it, plus a manual
  refresh button.
- **Bring your own AI key.** Supports Anthropic (Claude) by default, with
  OpenAI and Google (Gemini) as alternative providers.
- **Read-only Gmail access.** Uses the `gmail.readonly` OAuth scope — the
  extension can never send, delete, or modify your mail.

## How it works

```
content/content.js        → injects the button + panel into Gmail's page
content/panel-ui.js        → the floating panel UI (Shadow DOM, isolated styles)
background/background.js   → service worker: message router + alarm scheduler
background/gmail.js         → OAuth + Gmail REST API (list/get messages, MIME parsing)
background/ai.js            → calls Anthropic/OpenAI/Gemini, returns {topic, summary, priority} per email
background/storage.js       → settings/cache schema + chrome.storage helpers
options/                    → settings page (connect Gmail, API key, topics)
popup/                      → toolbar quick-status popup
```

Flow: the content script asks the background service worker for state →
the background worker fetches matching emails from the Gmail API → batches
them into a single AI call that classifies + summarizes each one → results
are cached in `chrome.storage.local` and broadcast to any open Gmail tabs →
the panel renders topic tabs from the cache.

## Setup

### 1. Enable the Gmail API and create an OAuth client

Gmail API access requires a Google Cloud OAuth client tied to your specific
extension ID. This is a one-time setup:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (or reuse one).
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** → configure it (External is
   fine for personal use; add your own Google account as a test user if the
   app stays in "Testing" mode).
4. Load the extension unpacked once so Chrome assigns it an ID (see step 2
   below), then copy that ID.
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → Application type **Chrome Extension** → paste the extension ID.
6. Copy the generated Client ID into `manifest.json`, replacing the
   placeholder:
   ```json
   "oauth2": {
     "client_id": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
     ...
   }
   ```
7. Reload the extension in `chrome://extensions` for the manifest change to
   take effect.

### 2. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension for quick access (optional).

### 3. Get an AI API key

- **Anthropic (default):** create a key at
  [console.anthropic.com](https://console.anthropic.com/).
- **OpenAI (alternative):** create a key at
  [platform.openai.com](https://platform.openai.com/).
- **Gemini (alternative):** create a key at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Uses
  Google's Interactions API (`v1beta/interactions`) with
  `gemini-3.5-flash-lite` by default — a fast, low-cost tier that's a good
  fit for short classification/summary calls. `gemini-3.8-flash` (the
  larger flagship model) works too if you set it in Settings, though as a
  brand-new release it may return `503` "high demand" errors under load.

### 4. Configure the extension

1. Click the extension icon → **Settings** (or right-click the icon →
   Options).
2. Click **Connect Gmail** and sign in.
3. Choose a provider, paste your API key, and click **Test connection**.
4. Edit the default topics or add your own (e.g. add "Swimming" with a
   description like *"swim practice times, meet schedules, pool
   closures"*).
5. Adjust the Gmail search query, max emails per scan, and refresh interval
   if you want.
6. Click **Save settings**.

### 5. Use it

Open Gmail. You'll see an **AI Summary** button above Compose, with a badge
showing how many important emails were found. Click it to see topic tabs
with AI-written summaries; click any card to jump straight to that email
thread.

## Security notes

- Your AI API key is stored in `chrome.storage.local` (this browser
  profile only, never synced) and is sent directly from your machine to
  Anthropic/OpenAI/Google. Nothing passes through a third-party server.
- Because the key lives in a browser extension, anyone with local access to
  this Chrome profile could in principle extract it. This is fine for
  personal use, but **do not publish a build of this extension with your
  key baked in**, and don't distribute it to other users as-is — for a
  multi-user deployment, put the AI call behind your own backend so the key
  never reaches the browser.
- The Gmail OAuth scope is `gmail.readonly` (read-only).

## Customizing

- **Icons:** replace the placeholder files in `icons/` (16/48/128 px PNG).
- **Default topics:** edit `DEFAULT_TOPICS` in `background/storage.js`.
- **Models:** change the defaults in `background/storage.js`
  (`model` / `openaiModel` / `geminiModel`) or override per-provider in Settings.
- **What counts as "important":** edit the Gmail search query in Settings —
  any valid [Gmail search operator](https://support.google.com/mail/answer/7190)
  works, e.g. `in:inbox label:important OR from:boss@company.com`.

## Known limitations

- Gmail's DOM markup isn't public/stable API; the button injection targets
  the long-standing `[gh="cm"]` hook near Compose, but a future Gmail
  redesign could require a selector update in `content/content.js`.
- Summarization quality depends on the AI model and how specific your topic
  descriptions are — vague descriptions lead to more emails landing in
  "Other".
- Each refresh sends email content (subject + a body excerpt) to your
  chosen AI provider.
