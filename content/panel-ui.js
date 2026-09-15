// Builds the floating AI-summary panel inside a Shadow DOM so Gmail's
// global styles can't leak in (and ours can't leak out).

(function () {
  const STYLES = `
    :host { all: initial; }
    .panel {
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      background: #fff;
      color: #202124;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 10px 30px rgba(0,0,0,0.18);
      border: 1px solid rgba(0,0,0,0.06);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      max-height: 520px;
    }
    .panel-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 8px; }
    .panel-title { font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }
    .sparkle { color:#4f46e5; }
    .panel-actions { display:flex; gap:4px; }
    .icon-btn {
      border:none; background:transparent; cursor:pointer; font-size:15px;
      width:28px; height:28px; border-radius:50%; color:#5f6368;
      display:flex; align-items:center; justify-content:center;
    }
    .icon-btn:hover { background:#f1f3f4; color:#202124; }
    .icon-btn.spinning { animation: gmailai-spin 0.8s linear infinite; }
    @keyframes gmailai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .panel-meta { padding:0 16px 8px; font-size:12px; color:#5f6368; }
    .panel-tabs { display:flex; gap:6px; padding:0 12px 10px; overflow-x:auto; }
    .tab {
      border:1px solid #dadce0; background:#fff; color:#3c4043;
      border-radius:999px; padding:5px 12px; font-size:12.5px; cursor:pointer;
      white-space:nowrap; display:flex; align-items:center; gap:6px; flex:none;
      border-left: 3px solid var(--tab-color, #5f6368);
    }
    .tab.active { background:#eef1ff; border-color:#c5cae9; color:#1a1a2e; font-weight:600; }
    .tab-count { color:#5f6368; font-weight:600; }
    .tab.active .tab-count { color:#4f46e5; }
    .panel-body { padding:4px 12px 12px; overflow-y:auto; flex:1 1 auto; }
    .card {
      display:block; text-decoration:none; color:inherit;
      border:1px solid #e8eaed; border-radius:10px; padding:10px 12px; margin-bottom:8px;
    }
    .card:hover { background:#f8f9ff; border-color:#c5cae9; }
    .card-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:2px; gap:8px; }
    .card-from { font-size:12px; color:#5f6368; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .card-priority { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; flex:none; }
    .priority-high { color:#c5221f; }
    .priority-low { color:#5f6368; }
    .card-subject { font-size:13.5px; font-weight:600; margin-bottom:3px; }
    .card-summary { font-size:12.5px; color:#3c4043; line-height:1.4; }
    .panel-footer { border-top:1px solid #f1f3f4; padding:8px 16px; }
    .link-btn { background:none; border:none; color:#4f46e5; font-size:12.5px; cursor:pointer; padding:0; }
    .link-btn:hover { text-decoration:underline; }
    .primary-btn {
      margin-top:10px; background:#4f46e5; color:#fff; border:none; border-radius:8px;
      padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer;
    }
    .primary-btn:hover { background:#4338ca; }
    .state-msg { padding:24px 8px; text-align:center; font-size:13px; color:#5f6368; }
    .state-error { color:#c5221f; }

    @media (prefers-color-scheme: dark) {
      .panel { background:#2d2e31; color:#e8eaed; border-color: rgba(255,255,255,0.08); }
      .panel-meta { color:#9aa0a6; }
      .tab { background:#2d2e31; border-color:#5f6368; color:#e8eaed; }
      .tab.active { background:#3c3d5c; border-color:#8ab4f8; color:#fff; }
      .icon-btn { color:#9aa0a6; }
      .icon-btn:hover { background:#3c4043; color:#fff; }
      .card { border-color:#3c4043; }
      .card:hover { background:#33344a; border-color:#5c6bc0; }
      .card-from, .card-summary { color:#c8c9cb; }
      .panel-footer { border-color:#3c4043; }
    }
  `;

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
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

  function shortFrom(from) {
    if (!from) return 'Unknown sender';
    const match = from.match(/^"?([^"<]+)"?\s*<.*>$/);
    return (match ? match[1] : from.split('<')[0]).trim() || from;
  }

  function gmailThreadUrl(threadId) {
    const acctMatch = location.pathname.match(/\/mail\/u\/(\d+)\//);
    const acct = acctMatch ? acctMatch[1] : '0';
    return `https://mail.google.com/mail/u/${acct}/#all/${threadId}`;
  }

  class GmailAIPanel {
    constructor(callbacks) {
      this.callbacks = callbacks || {};
      this.selectedTopicId = null;
      this.visible = false;
      this._anchorEl = null;
      this._buildDom();
    }

    _buildDom() {
      this.host = document.createElement('div');
      this.host.setAttribute('data-gmailai', 'panel-host');
      this.host.style.all = 'initial';
      this.host.style.position = 'fixed';
      this.host.style.zIndex = '2147483000';
      this.host.style.display = 'none';

      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><span class="sparkle" aria-hidden="true">&#10022;</span>AI Summary</div>
            <div class="panel-actions">
              <button class="icon-btn" data-action="refresh" aria-label="Refresh">&#8635;</button>
              <button class="icon-btn" data-action="close" aria-label="Close">&#10005;</button>
            </div>
          </div>
          <div class="panel-meta"></div>
          <div class="panel-tabs" role="tablist"></div>
          <div class="panel-body"></div>
          <div class="panel-footer">
            <button class="link-btn" data-action="manage">Manage topics</button>
          </div>
        </div>`;

      this.panelEl = this.shadow.querySelector('.panel');
      this.metaEl = this.shadow.querySelector('.panel-meta');
      this.tabsEl = this.shadow.querySelector('.panel-tabs');
      this.bodyEl = this.shadow.querySelector('.panel-body');
      this.refreshBtn = this.shadow.querySelector('[data-action="refresh"]');

      this.refreshBtn.addEventListener('click', () => this.callbacks.onRefresh?.());
      this.shadow.querySelector('[data-action="close"]').addEventListener('click', () => this.hide());
      this.shadow.querySelector('[data-action="manage"]').addEventListener('click', () => this.callbacks.onManageTopics?.());

      this._onDocMouseDown = (e) => {
        if (!this.visible) return;
        const path = e.composedPath();
        if (path.includes(this.host) || (this._anchorEl && path.includes(this._anchorEl))) return;
        this.hide();
      };
      this._onKeyDown = (e) => {
        if (e.key === 'Escape') this.hide();
      };
      this._onResize = () => {
        if (this.visible) this._position();
      };
    }

    mount() {
      if (!this.host.isConnected) document.body.appendChild(this.host);
    }

    _position() {
      if (!this._anchorEl) return;
      const rect = this._anchorEl.getBoundingClientRect();
      const width = 380;
      const maxLeft = window.innerWidth - width - 12;
      const left = Math.max(12, Math.min(rect.left, maxLeft));
      const top = rect.bottom + 8;
      this.host.style.left = `${left}px`;
      this.host.style.top = `${top}px`;
      this.host.style.width = `${width}px`;
      const maxHeight = window.innerHeight - top - 16;
      this.panelEl.style.maxHeight = `${Math.max(240, maxHeight)}px`;
    }

    show(anchorEl) {
      this._anchorEl = anchorEl;
      this.mount();
      this._position();
      this.visible = true;
      this.host.style.display = 'block';
      document.addEventListener('mousedown', this._onDocMouseDown, true);
      document.addEventListener('keydown', this._onKeyDown, true);
      window.addEventListener('resize', this._onResize);
      anchorEl.setAttribute('aria-expanded', 'true');
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      this.host.style.display = 'none';
      document.removeEventListener('mousedown', this._onDocMouseDown, true);
      document.removeEventListener('keydown', this._onKeyDown, true);
      window.removeEventListener('resize', this._onResize);
      this._anchorEl?.setAttribute('aria-expanded', 'false');
    }

    toggle(anchorEl) {
      if (this.visible) this.hide();
      else this.show(anchorEl);
    }

    setLoadingIndicator(loading) {
      this.refreshBtn.classList.toggle('spinning', !!loading);
    }

    render(state) {
      const { settings, cache, auth } = state;
      this.setLoadingIndicator(cache?.loading);

      if (cache?.error) {
        this._renderError(cache.error);
        return;
      }
      if (!auth?.connected) {
        this._renderConnectPrompt();
        return;
      }

      const topics = [...(settings?.topics || []), { id: 'other', name: 'Other', color: '#5f6368' }];
      const counts = topics.map((t) => ({ ...t, count: (cache?.byTopic?.[t.id] || []).length }));
      const visibleTopics = counts.filter((t) => t.count > 0);

      if (!this.selectedTopicId || !visibleTopics.some((t) => t.id === this.selectedTopicId)) {
        this.selectedTopicId = visibleTopics[0]?.id || null;
      }

      this.metaEl.textContent = cache?.loading
        ? 'Refreshing…'
        : cache?.lastUpdated
          ? `Updated ${relativeTime(cache.lastUpdated)}`
          : 'Not refreshed yet';

      if (visibleTopics.length === 0) {
        this.tabsEl.innerHTML = '';
        this.bodyEl.innerHTML = `<div class="state-msg">${
          cache?.loading ? 'Reading your inbox…' : 'No important emails right now.'
        }</div>`;
        return;
      }

      this.tabsEl.innerHTML = visibleTopics
        .map(
          (t) => `
        <button class="tab ${t.id === this.selectedTopicId ? 'active' : ''}" data-topic="${escapeHtml(t.id)}" style="--tab-color:${escapeHtml(t.color || '#5f6368')}">
          ${escapeHtml(t.name)} <span class="tab-count">${t.count}</span>
        </button>`
        )
        .join('');

      this.tabsEl.querySelectorAll('.tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedTopicId = btn.dataset.topic;
          this.render(state);
        });
      });

      const items = cache?.byTopic?.[this.selectedTopicId] || [];
      this.bodyEl.innerHTML = items
        .map(
          (item) => `
        <a class="card" href="${escapeHtml(gmailThreadUrl(item.threadId))}">
          <div class="card-top">
            <span class="card-from">${escapeHtml(shortFrom(item.from))}</span>
            <span class="card-priority priority-${escapeHtml(item.priority)}">${
              item.priority === 'high' ? 'Action' : item.priority === 'low' ? 'FYI' : ''
            }</span>
          </div>
          <div class="card-subject">${escapeHtml(item.subject)}</div>
          <div class="card-summary">${escapeHtml(item.summary)}</div>
        </a>`
        )
        .join('');
    }

    _renderConnectPrompt() {
      this.metaEl.textContent = '';
      this.tabsEl.innerHTML = '';
      this.bodyEl.innerHTML = `
        <div class="state-msg">
          <p>Connect your Gmail account to start seeing AI summaries.</p>
          <button class="primary-btn" data-action="connect">Connect Gmail</button>
        </div>`;
      this.bodyEl.querySelector('[data-action="connect"]').addEventListener('click', () => this.callbacks.onConnectGmail?.());
    }

    _renderError(message) {
      this.metaEl.textContent = '';
      this.tabsEl.innerHTML = '';
      this.bodyEl.innerHTML = `
        <div class="state-msg state-error">
          <p>${escapeHtml(message)}</p>
          <button class="link-btn" data-action="settings">Open settings</button>
        </div>`;
      this.bodyEl.querySelector('[data-action="settings"]').addEventListener('click', () => this.callbacks.onManageTopics?.());
    }
  }

  window.GmailAIPanel = GmailAIPanel;
})();
