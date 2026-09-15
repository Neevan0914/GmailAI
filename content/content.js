// Injects the "AI Summary" launcher above Gmail's Compose button and
// wires it up to the background service worker + floating panel.

(function () {
  const INJECTED_ATTR = 'data-gmailai-injected';
  const SPARKLE_SVG =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L14.09 8.26L20.5 9.27L15.75 13.64L17.18 20L12 16.62L6.82 20L8.25 13.64L3.5 9.27L9.91 8.26L12 2Z" fill="currentColor"/></svg>';

  let panel = null;
  let launcherBtn = null;
  let latestState = null;

  function safeSendMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          callback?.(null);
          return;
        }
        callback?.(res);
      });
    } catch (err) {
      callback?.(null);
    }
  }

  function buildLauncher() {
    const wrap = document.createElement('div');
    wrap.className = 'gmailai-launcher';
    wrap.setAttribute(INJECTED_ATTR, 'true');
    wrap.innerHTML = `
      <button type="button" class="gmailai-launcher-btn" aria-haspopup="true" aria-expanded="false">
        <span class="gmailai-icon">${SPARKLE_SVG}</span>
        <span class="gmailai-label">AI Summary</span>
        <span class="gmailai-badge" hidden>0</span>
      </button>`;
    launcherBtn = wrap.querySelector('button');
    launcherBtn.addEventListener('click', onLauncherClick);
    return wrap;
  }

  function ensurePanel() {
    if (!panel) {
      panel = new window.GmailAIPanel({
        onRefresh: forceRefresh,
        onManageTopics: openOptions,
        onConnectGmail: connectGmail,
      });
    }
    return panel;
  }

  function onLauncherClick() {
    const p = ensurePanel();
    p.toggle(launcherBtn);
    if (p.visible) requestState();
  }

  function injectIfNeeded() {
    const composeHook = document.querySelector('[gh="cm"]');
    if (!composeHook || !composeHook.parentElement) return;

    const existing = composeHook.parentElement.querySelector(`[${INJECTED_ATTR}]`);
    if (existing) {
      if (existing.nextElementSibling !== composeHook) {
        composeHook.parentElement.insertBefore(existing, composeHook);
      }
      return;
    }

    composeHook.parentElement.insertBefore(buildLauncher(), composeHook);
    updateBadge();
  }

  function updateBadge() {
    if (!launcherBtn) return;
    const badge = launcherBtn.querySelector('.gmailai-badge');
    const total = latestState?.auth?.connected
      ? Object.values(latestState.cache?.byTopic || {}).reduce((sum, arr) => sum + arr.length, 0)
      : 0;
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function applyState(state) {
    latestState = state;
    updateBadge();
    if (panel && panel.visible) panel.render(state);
  }

  function requestState() {
    safeSendMessage({ type: 'GET_STATE' }, (res) => {
      if (res) applyState(res);
    });
  }

  function forceRefresh() {
    safeSendMessage({ type: 'FORCE_REFRESH' }, (res) => {
      if (res) applyState(res);
    });
  }

  function connectGmail() {
    safeSendMessage({ type: 'CONNECT_GMAIL' }, (res) => {
      if (res?.error) {
        applyState({
          settings: latestState?.settings || {},
          auth: { connected: false },
          cache: { ...(latestState?.cache || {}), loading: false, error: res.error },
        });
        return;
      }
      requestState();
    });
  }

  function openOptions() {
    safeSendMessage({ type: 'OPEN_OPTIONS' });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SUMMARIES_UPDATED') {
      applyState(message.payload);
    }
  });

  const observer = new MutationObserver(() => injectIfNeeded());
  observer.observe(document.body, { childList: true, subtree: true });

  injectIfNeeded();
  requestState();
})();
