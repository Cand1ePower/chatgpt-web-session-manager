(() => {
  if (window.__CGPT_CARD_MANAGER__) return;
  window.__CGPT_CARD_MANAGER__ = true;

  const BATCH_SIZE = 24;
  const DETAIL_CONCURRENCY = 1;
  const DETAIL_MIN_INTERVAL_MS = 1100;
  const MAX_BACKGROUND_QUEUE = 8;
  const DELETE_DELAY_MS = 800;
  const MAX_429_RETRIES = 4;
  const HOVER_EXPAND_DELAY_MS = 500;
  const HOVER_COLLAPSE_DELAY_MS = 110;

  const state = {
    token: null,
    chats: [],
    total: 0,
    offset: 0,
    loadingList: false,
    query: '',
    selected: new Set(),
    details: new Map(),
    createdTimes: new Map(),
    detailPromises: new Map(),
    queue: [],
    activeLoads: 0,
    lastDetailRequestAt: 0,
    rateLimitUntil: 0,
    rateLimitHits: 0,
    queueTimer: null,
    opened: false,
    working: false,
    expandedId: null,
    hoverTimer: null,
    collapseTimer: null,
  };

  const host = document.createElement('div');
  host.id = 'cgpt-card-manager-host';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      button, input { font: inherit; }
      .launcher {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483646;
        width: 48px; height: 48px; border: 0; border-radius: 15px;
        background: rgba(18,18,20,.92); color: #fff; cursor: pointer;
        box-shadow: 0 12px 40px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.10);
        display: grid; place-items: center; font: 700 16px/1 system-ui, sans-serif;
        transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease;
        backdrop-filter: blur(18px);
      }
      .launcher:hover { transform: translateY(-3px) scale(1.04); box-shadow: 0 18px 50px rgba(0,0,0,.34), inset 0 0 0 1px rgba(255,255,255,.14); }
      .launcher .gridIcon { width: 18px; height: 18px; display:grid; grid-template-columns:repeat(2,1fr); gap:3px; }
      .launcher .gridIcon i { display:block; border-radius:3px; background:#fff; opacity:.94; }

      .overlay { position: fixed; inset: 0; z-index: 2147483645; display: none; background: rgba(8,8,10,.34); backdrop-filter: blur(8px); }
      .overlay.open { display: block; animation: fadeIn .16s ease-out; }
      @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }

      .panel {
        position:absolute; inset: 16px; min-width: 760px; overflow:hidden;
        border-radius: 22px; background: color-mix(in srgb, #f6f6f5 94%, transparent);
        color:#171719; border:1px solid rgba(0,0,0,.09);
        box-shadow: 0 30px 90px rgba(0,0,0,.30);
        display:grid; grid-template-rows:auto 1fr auto;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        .panel { background: color-mix(in srgb, #171719 95%, transparent); color:#f3f3f4; border-color:rgba(255,255,255,.10); }
      }
      .topbar, .footer { position:relative; z-index:70; background:inherit; }
      .topbar { min-height:76px; padding: 14px 16px; display:flex; align-items:center; gap:12px; border-bottom:1px solid rgba(127,127,127,.18); }
      .brand { min-width:190px; padding-left:2px; }
      .brand b { display:block; font-size:17px; letter-spacing:-.02em; }
      .brand span { display:block; margin-top:4px; font-size:12px; opacity:.56; }
      .search { flex:1; height:44px; border:0; outline:none; border-radius:14px; padding:0 14px; color:inherit; background:rgba(127,127,127,.10); box-shadow: inset 0 0 0 1px rgba(127,127,127,.10); }
      .search:focus { box-shadow: inset 0 0 0 1.5px rgba(127,127,127,.34), 0 0 0 4px rgba(127,127,127,.07); }
      .btn { height:40px; border:0; padding:0 13px; border-radius:12px; cursor:pointer; color:inherit; background:rgba(127,127,127,.11); transition:.18s ease; }
      .btn:hover { background:rgba(127,127,127,.18); transform:translateY(-1px); }
      .btn.primary { background:#171719; color:white; }
      @media (prefers-color-scheme: dark) { .btn.primary { background:#f1f1f2; color:#151517; } }
      .btn.danger { color:#c92b2b; background:rgba(220,38,38,.09); }
      .btn.danger:hover { background:rgba(220,38,38,.16); }
      .btn:disabled { opacity:.42; cursor:not-allowed; transform:none; }
      .close { width:40px; padding:0; font-size:19px; }

      .content { min-height:0; overflow:auto; padding: 16px; overscroll-behavior:contain; position:relative; }
      .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; align-items:start; }
      .empty { grid-column:1/-1; padding:70px 20px; text-align:center; opacity:.52; }

      /* The grid item never changes height. Only the inner surface expands, so other cards never move. */
      .card { position:relative; height:170px; min-height:170px; overflow:visible; z-index:1; }
      .cardSurface {
        position:absolute; inset:0; height:170px; overflow:hidden;
        border-radius:17px; background:rgba(255,255,255,.76); border:1px solid rgba(0,0,0,.08);
        box-shadow: 0 4px 18px rgba(0,0,0,.045);
        transition: height .42s cubic-bezier(.22,.8,.24,1), transform .36s cubic-bezier(.22,.8,.24,1), box-shadow .28s ease, border-color .2s ease;
        will-change:height, transform; z-index:1;
      }
      @media (prefers-color-scheme: dark) { .cardSurface { background:#202022; border-color:rgba(255,255,255,.09); box-shadow:none; } }
      .card.expanded { z-index:50; }
      .card.expanded .cardSurface {
        position:fixed; inset:auto;
        left:var(--expand-left); top:var(--expand-top);
        width:var(--expand-width); height:var(--expand-height);
        transform:none;
        box-shadow:0 30px 90px rgba(0,0,0,.34), 0 0 0 1px rgba(127,127,127,.14);
        border-color:rgba(127,127,127,.30); z-index:60;
        transition:left .36s cubic-bezier(.22,.8,.24,1), top .36s cubic-bezier(.22,.8,.24,1), width .38s cubic-bezier(.22,.8,.24,1), height .38s cubic-bezier(.22,.8,.24,1), box-shadow .28s ease, border-color .2s ease;
      }
      .card.selected .cardSurface { outline:2px solid currentColor; outline-offset:1px; }
      .card.deleted .cardSurface { opacity:.25; transform:scale(.97); pointer-events:none; }

      .focusVeil {
        position:absolute; left:0; right:0; top:76px; bottom:64px; z-index:20;
        opacity:0; pointer-events:none;
        background:rgba(20,20,22,.025);
        backdrop-filter: blur(1.6px) saturate(.96);
        -webkit-backdrop-filter: blur(1.6px) saturate(.96);
        transition:opacity .22s ease;
      }
      .panel.hasExpanded .focusVeil { opacity:1; pointer-events:auto; }
      @media (prefers-color-scheme: dark) { .focusVeil { background:rgba(0,0,0,.055); } }

      .cardHead { padding:14px 14px 10px; display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:start; }
      .check { width:18px; height:18px; margin:2px 0 0; accent-color:#111; cursor:pointer; }
      .titleWrap { min-width:0; }
      .title { font-size:14px; line-height:1.35; font-weight:680; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
      .meta { display:flex; gap:7px; margin-top:6px; font-size:11px; opacity:.56; white-space:nowrap; overflow:hidden; }
      .meta .createdAt { overflow:hidden; text-overflow:ellipsis; }
      .mini { border:0; background:transparent; color:inherit; width:26px; height:26px; border-radius:8px; cursor:pointer; opacity:.55; }
      .mini:hover { background:rgba(127,127,127,.12); opacity:1; }

      .preview { padding:0 14px 13px 42px; height:98px; overflow:hidden; transition:height .34s ease, opacity .2s ease; }
      .previewItem { display:grid; grid-template-columns:34px 1fr; gap:7px; align-items:start; margin-bottom:7px; }
      .previewLabel { font-size:10px; line-height:1.55; font-weight:750; opacity:.42; padding-top:1px; }
      .previewText { font-size:12.3px; line-height:1.48; opacity:.74; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; word-break:break-word; }
      .previewItem.recent .previewText { opacity:.58; -webkit-line-clamp:1; }
      .card.expanded .preview, .card.expanded .loadingPreview { display:none; }

      .loadingPreview { padding:1px 14px 14px 42px; height:98px; }
      .loadingStatus { display:flex; align-items:center; gap:7px; font-size:11px; opacity:.58; margin-bottom:10px; }
      .spinner { width:13px; height:13px; border:1.5px solid rgba(127,127,127,.28); border-top-color:currentColor; border-radius:50%; animation:spin .75s linear infinite; opacity:.72; }
      @keyframes spin { to { transform:rotate(360deg); } }
      .skeleton { height:8px; margin:8px 0; border-radius:99px; background:linear-gradient(90deg, rgba(127,127,127,.09), rgba(127,127,127,.20), rgba(127,127,127,.09)); background-size:220% 100%; animation:shimmer 1.2s ease-in-out infinite; }
      .skeleton.s1 { width:91%; } .skeleton.s2 { width:73%; } .skeleton.s3 { width:48%; }
      @keyframes shimmer { 0% { background-position:100% 0 } 100% { background-position:-120% 0 } }

      .fade { position:absolute; left:0; right:0; bottom:0; height:44px; pointer-events:none; background:linear-gradient(transparent, rgba(255,255,255,.98)); transition:opacity .18s ease; }
      @media (prefers-color-scheme: dark) { .fade { background:linear-gradient(transparent, #202022); } }
      .card.expanded .fade { opacity:0; }

      .expandedBody {
        padding:0 10px 12px 42px; max-height:0; opacity:0; overflow:hidden; pointer-events:none;
        transition:max-height .40s cubic-bezier(.22,.8,.24,1), opacity .20s ease .10s;
      }
      .card.expanded .expandedBody {
        max-height:none; height:calc(var(--expand-height) - 74px); opacity:1; pointer-events:auto;
        padding:0 14px 15px 14px;
        display:grid; grid-template-columns:minmax(280px,.9fr) minmax(0,2fr); gap:12px;
      }
      .digest {
        margin:0; padding:13px 13px 12px; border-radius:14px;
        background:rgba(127,127,127,.075); border:1px solid rgba(127,127,127,.08);
        min-height:0; overflow:auto; scrollbar-width:thin;
      }
      .digestHead { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
      .digestHead b { font-size:13px; letter-spacing:.01em; }
      .digestHead span { font-size:10px; opacity:.44; white-space:nowrap; }
      .digestRow { display:grid; grid-template-columns:52px 1fr; gap:8px; margin-top:9px; align-items:start; }
      .digestRow b { font-size:10.5px; opacity:.48; line-height:1.5; }
      .digestRow span { font-size:12.2px; line-height:1.52; opacity:.82; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:4; overflow:hidden; word-break:break-word; }

      .messages { margin:0; padding:0 5px 5px 0; height:100%; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }
      .msg { margin:0 0 10px; padding:10px 11px; border-radius:12px; font-size:12.6px; line-height:1.56; white-space:pre-wrap; word-break:break-word; background:rgba(127,127,127,.075); }
      .msg.user { background:rgba(127,127,127,.145); }
      .role { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:9.5px; font-weight:750; letter-spacing:.04em; opacity:.43; margin-bottom:4px; }
      .msgBody { position:relative; max-height:132px; overflow:hidden; }
      .msgBody.long:not(.open)::after { content:""; position:absolute; left:0; right:0; bottom:0; height:28px; background:linear-gradient(transparent, rgba(127,127,127,.11)); pointer-events:none; }
      .msgBody.open { max-height:none; }
      .msgToggle { border:0; padding:3px 0 0; background:transparent; color:inherit; cursor:pointer; font-size:10px; opacity:.55; }
      .msgToggle:hover { opacity:.9; }
      .moreHint { padding:8px; text-align:center; font-size:10.5px; opacity:.42; }

      .footer { min-height:64px; padding:11px 16px; border-top:1px solid rgba(127,127,127,.18); display:flex; align-items:center; gap:10px; }
      .stats { margin-right:auto; font-size:12px; opacity:.62; }
      .progress { font-size:12px; min-width:150px; text-align:right; opacity:.66; }
      .toolbarSep { width:1px; height:26px; background:rgba(127,127,127,.18); }
      .toast { position:absolute; z-index:90; left:50%; bottom:78px; transform:translateX(-50%) translateY(12px); padding:10px 13px; border-radius:12px; background:#171719; color:#fff; font-size:12px; opacity:0; pointer-events:none; transition:.22s ease; box-shadow:0 10px 34px rgba(0,0,0,.25); }
      .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
      @media (prefers-color-scheme: dark) { .toast { background:#f2f2f3; color:#151517; } }
    </style>
    <button class="launcher" title="ChatGPT 对话卡片管理器" aria-label="打开对话管理器"><span class="gridIcon"><i></i><i></i><i></i><i></i></span></button>
    <div class="overlay">
      <section class="panel">
        <header class="topbar">
          <div class="brand"><b>Chat Deck</b><span>分批读取 · 速览预览 · 批量管理</span></div>
          <input class="search" placeholder="搜索已加载的标题或正文…" />
          <button class="btn" data-act="selectVisible">选择当前</button>
          <button class="btn close" data-act="close" title="关闭">×</button>
        </header>
        <main class="content"><div class="grid"></div></main>
        <div class="focusVeil"></div>
        <footer class="footer">
          <div class="stats">尚未加载</div>
          <button class="btn" data-act="loadMore">加载下一批</button>
          <div class="toolbarSep"></div>
          <button class="btn" data-act="archive">归档所选</button>
          <button class="btn danger" data-act="delete">删除所选</button>
          <div class="progress"></div>
        </footer>
        <div class="toast"></div>
      </section>
    </div>
  `;

  const $ = (s) => root.querySelector(s);
  const panel = $('.panel');
  const overlay = $('.overlay');
  const grid = $('.grid');
  const content = $('.content');
  const search = $('.search');
  const stats = $('.stats');
  const progress = $('.progress');
  const toast = $('.toast');
  const loadMoreBtn = $('[data-act="loadMore"]');
  const archiveBtn = $('[data-act="archive"]');
  const deleteBtn = $('[data-act="delete"]');

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  async function getToken() {
    if (state.token) return state.token;
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error(`无法读取登录状态 (${res.status})`);
    const data = await res.json();
    state.token = data?.accessToken || null;
    return state.token;
  }

  async function api(path, options = {}) {
    const token = await getToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await fetch(path, { ...options, headers, credentials: 'include' });
    if (res.status === 401) {
      state.token = null;
      const retryToken = await getToken();
      if (retryToken) headers.set('Authorization', `Bearer ${retryToken}`);
      return fetch(path, { ...options, headers, credentials: 'include' });
    }
    return res;
  }

  function normalizeTimestamp(value) {
    if (value == null || value === '') return 0;
    if (value instanceof Date) return Number.isNaN(+value) ? 0 : +value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return 0;
      if (value < 1e11) return Math.round(value * 1000); // seconds
      if (value < 1e14) return Math.round(value);       // milliseconds
      return 0;
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return 0;
      if (/^\d+(\.\d+)?$/.test(s)) return normalizeTimestamp(Number(s));
      const parsed = Date.parse(s);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  function getListCreatedAt(chat) {
    return normalizeTimestamp(
      chat?.create_time ?? chat?.createTime ?? chat?.created_at ?? chat?.createdAt ?? chat?.creation_time
    );
  }

  function getCreatedAt(chat) {
    return state.createdTimes.get(chat?.id) || getListCreatedAt(chat) || 0;
  }

  function formatDateMs(ms, detailed = false) {
    if (!ms) return detailed ? '创建时间暂未返回' : '创建时间读取中…';
    const d = new Date(ms);
    if (Number.isNaN(+d)) return detailed ? '创建时间暂未返回' : '创建时间读取中…';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const options = detailed
      ? { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }
      : { ...(sameYear ? {} : { year:'2-digit' }), month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' };
    return new Intl.DateTimeFormat('zh-CN', options).format(d);
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function retryAfterMs(res, fallbackMs = 10000) {
    const raw = res?.headers?.get?.('Retry-After');
    if (!raw) return fallbackMs;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isNaN(date) ? fallbackMs : Math.max(1000, date - Date.now());
  }

  function setRateLimit(ms) {
    state.rateLimitHits += 1;
    state.rateLimitUntil = Math.max(state.rateLimitUntil, Date.now() + ms);
    progress.textContent = `请求过快，冷却 ${Math.ceil(ms / 1000)}s`;
    showToast(`触发 429，已自动降速并等待 ${Math.ceil(ms / 1000)} 秒`);
  }

  async function apiWith429Retry(path, options = {}, maxRetries = MAX_429_RETRIES) {
    let attempt = 0;
    while (true) {
      const wait = state.rateLimitUntil - Date.now();
      if (wait > 0) await sleep(wait);
      const res = await api(path, options);
      if (res.status !== 429 || attempt >= maxRetries) return res;
      const fallback = Math.min(90000, 8000 * (2 ** attempt));
      const delay = retryAfterMs(res, fallback) + Math.floor(Math.random() * 900);
      setRateLimit(delay);
      attempt += 1;
      await sleep(delay);
    }
  }

  async function loadNextBatch() {
    if (state.loadingList || (state.offset >= state.total && state.total !== 0)) return;
    state.loadingList = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = '读取中…';
    try {
      const url = `/backend-api/conversations?offset=${state.offset}&limit=${BATCH_SIZE}&order=updated`;
      const res = await apiWith429Retry(url, {}, 2);
      if (!res.ok) throw new Error(`列表读取失败 (${res.status})`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const known = new Set(state.chats.map(x => x.id));
      for (const item of items) {
        if (!item?.id || known.has(item.id)) continue;
        state.chats.push(item);
        const listTime = getListCreatedAt(item);
        if (listTime) state.createdTimes.set(item.id, listTime);
        known.add(item.id);
      }
      state.total = Number.isFinite(data?.total) ? data.total : Math.max(state.total, state.chats.length);
      state.offset += items.length;
      render();
      observeCards();
    } catch (err) {
      console.error('[Chat Deck]', err);
      showToast(err.message || '读取失败');
    } finally {
      state.loadingList = false;
      loadMoreBtn.disabled = state.offset >= state.total;
      loadMoreBtn.textContent = state.offset >= state.total && state.total ? '已全部加载' : '加载下一批';
      updateStats();
    }
  }

  function textFromPart(part) {
    if (typeof part === 'string') return part;
    if (part == null) return '';
    if (typeof part === 'number' || typeof part === 'boolean') return String(part);
    if (part?.text) return String(part.text);
    return '';
  }

  function cleanText(text, max = Infinity) {
    let s = String(text || '')
      .replace(/```[\s\S]*?```/g, ' [代码/配置片段] ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '· ')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length > max) s = `${s.slice(0, max).trim()}…`;
    return s;
  }

  function parseConversation(data) {
    const mapping = data?.mapping || {};
    const messages = [];
    let seq = 0;
    for (const node of Object.values(mapping)) {
      const m = node?.message;
      const role = m?.author?.role;
      if (!m || !['user', 'assistant'].includes(role)) continue;
      const parts = Array.isArray(m?.content?.parts) ? m.content.parts : [];
      const text = parts.map(textFromPart).filter(Boolean).join('\n').trim();
      if (!text) continue;
      messages.push({ role, text, time: normalizeTimestamp(m.create_time ?? m.createTime), seq: seq++ });
    }
    messages.sort((a,b) => {
      if (a.time && b.time) return a.time - b.time;
      if (a.time) return -1;
      if (b.time) return 1;
      return a.seq - b.seq;
    });
    const explicitCreated = normalizeTimestamp(
      data?.create_time ?? data?.createTime ?? data?.created_at ?? data?.createdAt ?? data?.creation_time
    );
    const earliestMessage = messages.reduce((min, m) => m.time && (!min || m.time < min) ? m.time : min, 0);
    return { messages, createdAt: explicitCreated || earliestMessage || 0 };
  }

  function markCardLoading(chatId) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(chatId)}"]`);
    if (!card || state.details.has(chatId)) return;
    const count = card.querySelector('.count');
    if (count) count.textContent = '读取中…';
  }

  function enqueueDetail(chatId, priority = false) {
    if (state.details.has(chatId) || state.detailPromises.has(chatId)) return;
    markCardLoading(chatId);

    const existing = state.queue.findIndex(x => x.id === chatId);
    if (existing >= 0) {
      if (priority) {
        const item = state.queue.splice(existing, 1)[0];
        item.priority = true;
        state.queue.unshift(item);
      }
      return;
    }

    if (!priority) {
      const backgroundCount = state.queue.filter(x => !x.priority).length;
      if (backgroundCount >= MAX_BACKGROUND_QUEUE) return;
    }
    const item = { id: chatId, priority };
    priority ? state.queue.unshift(item) : state.queue.push(item);
    pumpQueue();
  }

  function removeBackgroundQueued(chatId) {
    state.queue = state.queue.filter(x => x.id !== chatId || x.priority);
  }

  function pumpQueue() {
    clearTimeout(state.queueTimer);
    if (state.activeLoads >= DETAIL_CONCURRENCY || !state.queue.length) return;

    const cooldown = Math.max(0, state.rateLimitUntil - Date.now());
    const spacing = Math.max(0, DETAIL_MIN_INTERVAL_MS - (Date.now() - state.lastDetailRequestAt));
    const wait = Math.max(cooldown, spacing);
    if (wait > 0) {
      state.queueTimer = setTimeout(pumpQueue, wait + 20);
      return;
    }

    const item = state.queue.shift();
    const id = item.id;
    state.activeLoads++;
    state.lastDetailRequestAt = Date.now();
    const p = (async () => {
      try {
        const res = await api(`/backend-api/conversation/${encodeURIComponent(id)}`);
        if (res.status === 429) {
          const fallback = Math.min(90000, 9000 * (2 ** Math.min(state.rateLimitHits, 3)));
          const delay = retryAfterMs(res, fallback) + Math.floor(Math.random() * 1000);
          setRateLimit(delay);
          state.queue.unshift({ id, priority:true });
          return;
        }
        if (!res.ok) throw new Error(`正文读取失败 (${res.status})`);
        const data = await res.json();
        const parsed = parseConversation(data);
        state.details.set(id, parsed.messages);
        if (parsed.createdAt) state.createdTimes.set(id, parsed.createdAt);
        state.rateLimitHits = Math.max(0, state.rateLimitHits - 1);
      } catch (e) {
        state.details.set(id, [{ role:'assistant', text:`[无法读取：${e.message}]`, time:0 }]);
      } finally {
        state.detailPromises.delete(id);
        state.activeLoads--;
        updateCardDetail(id);
        pumpQueue();
      }
    })();
    state.detailPromises.set(id, p);
  }

  function filteredChats() {
    const q = state.query.trim().toLowerCase();
    if (!q) return state.chats;
    return state.chats.filter(c => {
      if ((c.title || '').toLowerCase().includes(q)) return true;
      const msgs = state.details.get(c.id);
      return msgs?.some(m => m.text.toLowerCase().includes(q));
    });
  }

  function escapeAttr(s='') { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function buildDigest(msgs) {
    const user = msgs.filter(m => m.role === 'user');
    const assistant = msgs.filter(m => m.role === 'assistant');
    const first = user[0]?.text || msgs[0]?.text || '';
    const lastUser = user[user.length - 1]?.text || first;
    const lastAnswer = assistant[assistant.length - 1]?.text || '';
    const chars = msgs.reduce((n, m) => n + m.text.length, 0);
    return {
      first: cleanText(first, 220),
      recent: cleanText(lastUser, 220),
      answer: cleanText(lastAnswer, 260),
      stats: `${user.length} 次提问 · ${assistant.length} 次回复 · ${chars.toLocaleString('zh-CN')} 字`,
    };
  }

  function loadingPreviewHTML() {
    return `<div class="loadingPreview">
      <div class="loadingStatus"><span class="spinner"></span><span>正在读取对话正文与创建时间…</span></div>
      <div class="skeleton s1"></div><div class="skeleton s2"></div><div class="skeleton s3"></div>
    </div>`;
  }

  function previewHTML(msgs) {
    const d = buildDigest(msgs);
    const same = d.first === d.recent;
    return `<div class="preview">
      <div class="previewItem"><span class="previewLabel">开始</span><span class="previewText">${escapeAttr(d.first || '没有可显示的文本')}</span></div>
      ${same ? '' : `<div class="previewItem recent"><span class="previewLabel">最近</span><span class="previewText">${escapeAttr(d.recent)}</span></div>`}
    </div>`;
  }

  function render() {
    collapseExpanded(true);
    const list = filteredChats();
    if (!list.length) {
      grid.innerHTML = `<div class="empty">${state.chats.length ? '没有匹配的已加载对话' : '点击“加载下一批”开始读取历史对话'}</div>`;
      updateStats();
      return;
    }
    grid.innerHTML = list.map(c => {
      const selected = state.selected.has(c.id);
      const msgs = state.details.get(c.id);
      const createdAt = getCreatedAt(c);
      const count = msgs ? `${msgs.length} 条消息` : '读取中…';
      return `<article class="card ${selected ? 'selected' : ''}" data-id="${escapeAttr(c.id)}">
        <div class="cardSurface">
          <div class="cardHead">
            <input class="check" type="checkbox" ${selected ? 'checked' : ''} aria-label="选择对话" />
            <div class="titleWrap">
              <div class="title" title="双击打开原对话">${escapeAttr(c.title || '无标题对话')}</div>
              <div class="meta"><span class="createdAt" title="${escapeAttr(formatDateMs(createdAt, true))}">创建 ${escapeAttr(formatDateMs(createdAt))}</span><span>·</span><span class="count">${count}</span></div>
            </div>
            <button class="mini" data-act="singleDelete" title="删除">×</button>
          </div>
          ${msgs ? previewHTML(msgs) : loadingPreviewHTML()}
          <div class="expandedBody"><div class="digest"></div><div class="messages"></div></div>
          <div class="fade"></div>
        </div>
      </article>`;
    }).join('');
    for (const c of list) if (state.details.has(c.id)) updateCardDetail(c.id);
    updateStats();
  }

  function updateCardDetail(id) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const msgs = state.details.get(id);
    if (!msgs) return;
    const chat = state.chats.find(c => c.id === id);
    const surface = card.querySelector('.cardSurface');
    const oldPreview = surface.querySelector('.preview, .loadingPreview');
    const temp = document.createElement('div');
    temp.innerHTML = previewHTML(msgs);
    oldPreview?.replaceWith(temp.firstElementChild);

    const count = card.querySelector('.count');
    if (count) count.textContent = `${msgs.length} 条消息`;
    const timeEl = card.querySelector('.createdAt');
    if (timeEl) {
      const ms = getCreatedAt(chat);
      timeEl.textContent = `创建 ${formatDateMs(ms)}`;
      timeEl.title = formatDateMs(ms, true);
    }

    const d = buildDigest(msgs);
    const digest = card.querySelector('.digest');
    digest.innerHTML = `<div class="digestHead"><b>对话速览</b><span>${escapeAttr(d.stats)}</span></div>
      <div class="digestRow"><b>开始</b><span title="${escapeAttr(d.first)}">${escapeAttr(d.first || '—')}</span></div>
      <div class="digestRow"><b>最近</b><span title="${escapeAttr(d.recent)}">${escapeAttr(d.recent || '—')}</span></div>
      ${d.answer ? `<div class="digestRow"><b>末次回复</b><span title="${escapeAttr(d.answer)}">${escapeAttr(d.answer)}</span></div>` : ''}`;

    const messages = card.querySelector('.messages');
    messages.textContent = '';
    const max = 80;
    for (const m of msgs.slice(0, max)) {
      const div = document.createElement('div');
      div.className = `msg ${m.role}`;

      const role = document.createElement('div');
      role.className = 'role';
      const roleName = document.createElement('span');
      roleName.textContent = m.role === 'user' ? '你' : 'ChatGPT';
      role.appendChild(roleName);
      if (m.time) {
        const t = document.createElement('span');
        t.textContent = new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit' }).format(new Date(m.time));
        role.appendChild(t);
      }

      const body = document.createElement('div');
      body.className = `msgBody ${m.text.length > 420 ? 'long' : ''}`;
      body.textContent = m.text;
      div.append(role, body);

      if (m.text.length > 420) {
        const toggle = document.createElement('button');
        toggle.className = 'msgToggle';
        toggle.dataset.act = 'toggleMsg';
        toggle.textContent = '展开这条消息';
        div.appendChild(toggle);
      }
      messages.appendChild(div);
    }
    if (msgs.length > max) {
      const hint = document.createElement('div');
      hint.className = 'moreHint';
      hint.textContent = `已显示前 ${max} 条文本消息 · 双击标题打开完整对话`;
      messages.appendChild(hint);
    }
  }

  let observer = null;
  function observeCards() {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.dataset.id;
        if (e.isIntersecting) enqueueDetail(id, false);
        else removeBackgroundQueued(id);
      }
    }, { root: content, rootMargin:'40px', threshold:.08 });
    grid.querySelectorAll('.card').forEach(card => observer.observe(card));
  }

  function updateStats() {
    const visible = filteredChats().length;
    stats.textContent = `已读取 ${state.chats.length}${state.total ? ` / ${state.total}` : ''} · 当前 ${visible} · 已选 ${state.selected.size}`;
    archiveBtn.disabled = deleteBtn.disabled = state.selected.size === 0 || state.working;
  }

  function expandCard(card) {
    if (!card?.isConnected) return;
    clearTimeout(state.collapseTimer);
    const id = card.dataset.id;
    if (state.expandedId && state.expandedId !== id) collapseExpanded(true);

    const rect = card.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const gap = 12;
    const targetWidth = Math.min(contentRect.width - 28, rect.width * 3 + gap * 2);
    const targetHeight = Math.min(contentRect.height - 24, rect.height * 3 + gap * 2);

    let left = rect.left - (targetWidth - rect.width) / 2;
    let top = rect.top - (targetHeight - rect.height) / 2;
    left = Math.max(contentRect.left + 10, Math.min(left, contentRect.right - targetWidth - 10));
    top = Math.max(contentRect.top + 10, Math.min(top, contentRect.bottom - targetHeight - 10));

    card.style.setProperty('--expand-left', `${Math.round(left)}px`);
    card.style.setProperty('--expand-top', `${Math.round(top)}px`);
    card.style.setProperty('--expand-width', `${Math.round(targetWidth)}px`);
    card.style.setProperty('--expand-height', `${Math.round(targetHeight)}px`);
    card.classList.add('expanded');
    panel.classList.add('hasExpanded');
    state.expandedId = id;
    enqueueDetail(id, true);
  }

  function collapseExpanded(immediate = false) {
    clearTimeout(state.hoverTimer);
    clearTimeout(state.collapseTimer);
    const run = () => {
      if (state.expandedId) {
        const card = grid.querySelector(`.card[data-id="${CSS.escape(state.expandedId)}"]`);
        card?.classList.remove('expanded');
      }
      state.expandedId = null;
      panel.classList.remove('hasExpanded');
    };
    if (immediate) run();
    else state.collapseTimer = setTimeout(run, HOVER_COLLAPSE_DELAY_MS);
  }

  async function patchConversation(id, body) {
    const res = await apiWith429Retry(`/backend-api/conversation/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) });
    if (!res.ok) throw new Error(`操作失败 (${res.status})`);
  }

  async function batchAction(mode, ids) {
    if (!ids.length || state.working) return;
    const label = mode === 'delete' ? '删除' : '归档';
    if (mode === 'delete' && !confirm(`确定永久删除选中的 ${ids.length} 个对话吗？\n\n此操作无法在本扩展中撤销。`)) return;
    collapseExpanded(true);
    state.working = true;
    updateStats();
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      progress.textContent = `${label} ${i + 1} / ${ids.length}`;
      try {
        await patchConversation(id, mode === 'delete' ? { is_visible:false } : { is_archived:true });
        ok++;
        const card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
        card?.classList.add('deleted');
        state.selected.delete(id);
        setTimeout(() => {
          state.chats = state.chats.filter(c => c.id !== id);
          state.details.delete(id);
          state.createdTimes.delete(id);
          render(); observeCards();
        }, 260);
      } catch (e) {
        failed++;
        console.error('[Chat Deck]', id, e);
      }
      if (i < ids.length - 1) await new Promise(r => setTimeout(r, DELETE_DELAY_MS));
    }
    state.working = false;
    progress.textContent = failed ? `完成 ${ok}，失败 ${failed}` : `完成 ${ok}`;
    showToast(`${label}完成：${ok}${failed ? `，失败 ${failed}` : ''}`);
    updateStats();
    setTimeout(() => { if (!state.working) progress.textContent = ''; }, 2200);
  }

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target.closest('.launcher')) {
      state.opened = true; overlay.classList.add('open');
      if (!state.chats.length) loadNextBatch();
      return;
    }
    if (act === 'close') { collapseExpanded(true); state.opened = false; overlay.classList.remove('open'); return; }
    if (act === 'loadMore') { loadNextBatch(); return; }
    if (act === 'selectVisible') {
      const list = filteredChats();
      const all = list.length && list.every(c => state.selected.has(c.id));
      for (const c of list) all ? state.selected.delete(c.id) : state.selected.add(c.id);
      render(); observeCards(); return;
    }
    if (act === 'archive') { batchAction('archive', [...state.selected]); return; }
    if (act === 'delete') { batchAction('delete', [...state.selected]); return; }
    if (act === 'toggleMsg') {
      const body = e.target.closest('.msg')?.querySelector('.msgBody');
      if (!body) return;
      body.classList.toggle('open');
      e.target.textContent = body.classList.contains('open') ? '收起这条消息' : '展开这条消息';
      return;
    }

    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.matches('.check')) {
      e.target.checked ? state.selected.add(id) : state.selected.delete(id);
      card.classList.toggle('selected', e.target.checked);
      updateStats();
      return;
    }
    if (act === 'singleDelete') { batchAction('delete', [id]); return; }
  });

  root.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.title');
    const card = e.target.closest('.card');
    if (title && card?.dataset.id) window.open(`/c/${encodeURIComponent(card.dataset.id)}`, '_blank', 'noopener');
  });

  root.addEventListener('pointerover', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    clearTimeout(state.collapseTimer);
    clearTimeout(state.hoverTimer);
    state.hoverTimer = setTimeout(() => expandCard(card), HOVER_EXPAND_DELAY_MS);
  });

  root.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    clearTimeout(state.hoverTimer);
    if (state.expandedId === card.dataset.id) collapseExpanded(false);
  });

  search.addEventListener('input', () => {
    state.query = search.value;
    render(); observeCards();
  });

  content.addEventListener('scroll', () => {
    if (state.expandedId) collapseExpanded(true);
    if (state.loadingList || !state.total || state.offset >= state.total) return;
    if (content.scrollTop + content.clientHeight > content.scrollHeight - 700) loadNextBatch();
  }, { passive:true });

  document.addEventListener('keydown', (e) => {
    if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      state.opened = !state.opened;
      overlay.classList.toggle('open', state.opened);
      if (!state.opened) collapseExpanded(true);
      if (state.opened && !state.chats.length) loadNextBatch();
    }
    if (e.key === 'Escape' && state.opened) {
      if (state.expandedId) collapseExpanded(true);
      else { state.opened = false; overlay.classList.remove('open'); }
    }
  });
})();
