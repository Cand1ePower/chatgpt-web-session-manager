(() => {
  if (window.__CGPT_CARD_MANAGER__) return;
  window.__CGPT_CARD_MANAGER__ = true;

  const BATCH_SIZE = 24;
  const LIST_FETCH_MAX = 100;
  const DETAIL_CONCURRENCY = 1;
  const DETAIL_MIN_INTERVAL_MS = 3200;
  const MANUAL_DETAIL_INTERVAL_MS = 4500;
  const BACKGROUND_DETAIL_INTERVAL_MS = 9000;
  const LIST_MIN_INTERVAL_MS = 1800;
  const MUTATION_MIN_INTERVAL_MS = 2200;
  const GLOBAL_MIN_INTERVAL_MS = 900;
  const MAX_BACKGROUND_QUEUE = 2;
  const AUTO_BACKGROUND_PREFETCH = false;
  const MAX_429_RETRIES = 0;
  const HOVER_EXPAND_DELAY_MS = 500;
  const HOVER_COLLAPSE_DELAY_MS = 110;
  const CACHE_DB_NAME = 'chatdeck-cache-v1';
  const CACHE_STORE = 'conversations';
  const CACHE_SOFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const PREFETCH_DISABLE_AFTER_429_MS = 30 * 60 * 1000;

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
    loadingIds: new Set(),
    detailErrors: new Map(),
    lastDetailRequestAt: 0,
    lastApiAt: 0,
    rateLimitUntil: Number(localStorage.getItem('chatdeck:rateLimitUntil') || 0),
    rateLimitHits: Number(localStorage.getItem('chatdeck:rateLimitHits') || 0),
    prefetchDisabledUntil: Number(localStorage.getItem('chatdeck:prefetchDisabledUntil') || 0),
    adaptiveIntervals: { list: LIST_MIN_INTERVAL_MS, detail: DETAIL_MIN_INTERVAL_MS, mutate: MUTATION_MIN_INTERVAL_MS },
    queueTimer: null,
    cacheReady: false,
    cacheHits: 0,
    opened: false,
    working: false,
    expandedId: null,
    hoverTimer: null,
    collapseTimer: null,
    morphAnimation: null,
    lastManualRequestAt: 0,
    manualLoading: false,
    manualPendingIds: new Set(),
    manualDone: 0,
    manualFailed: 0,
    manualTotal: 0,
    manualLabel: '',
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
        display:grid; grid-template-rows:auto auto 1fr auto;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        .panel { background: color-mix(in srgb, #171719 95%, transparent); color:#f3f3f4; border-color:rgba(255,255,255,.10); }
      }
      .topbar, .footer, .rateBanner { position:relative; z-index:70; background:inherit; }
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


      .rateBanner {
        margin:0; padding:0 16px; max-height:0; overflow:hidden; opacity:0;
        border-bottom:1px solid transparent;
        transition:max-height .24s ease, opacity .18s ease, padding .24s ease, border-color .24s ease;
      }
      .rateBanner.show {
        max-height:86px; opacity:1; padding:10px 16px;
        background:rgba(220,72,54,.09); border-bottom-color:rgba(220,72,54,.18);
      }
      .rateInner { display:flex; align-items:center; gap:11px; min-height:44px; }
      .rateIcon {
        flex:0 0 auto; width:30px; height:30px; border-radius:10px; display:grid; place-items:center;
        font-size:18px; font-weight:800; color:#b42318; background:rgba(220,72,54,.13);
      }
      .rateCopy { min-width:0; display:flex; flex-direction:column; gap:3px; }
      .rateCopy b { font-size:13px; color:#b42318; }
      .rateCopy span { font-size:11.5px; line-height:1.45; opacity:.72; }
      @media (prefers-color-scheme: dark) {
        .rateBanner.show { background:rgba(248,113,113,.10); border-bottom-color:rgba(248,113,113,.18); }
        .rateIcon, .rateCopy b { color:#ff9b91; }
        .rateIcon { background:rgba(248,113,113,.12); }
      }

      .content { min-height:0; overflow:auto; padding: 16px; overscroll-behavior:contain; position:relative; }
      .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; align-items:start; }
      .empty { grid-column:1/-1; padding:70px 20px; text-align:center; opacity:.52; }

      /* The grid placeholder never changes size. The surface is promoted at its exact on-screen rect and then morphs outward. */
      .card { position:relative; height:170px; min-height:170px; overflow:visible; z-index:1; }
      .cardSurface {
        position:absolute; inset:0; height:170px; overflow:hidden;
        border-radius:17px; background:rgba(255,255,255,.76); border:1px solid rgba(0,0,0,.08);
        box-shadow:0 4px 18px rgba(0,0,0,.045);
        transition:box-shadow .30s ease, border-color .24s ease, border-radius .42s cubic-bezier(.16,1,.3,1);
        transform-origin:center center; z-index:1;
      }
      @media (prefers-color-scheme: dark) { .cardSurface { background:#202022; border-color:rgba(255,255,255,.09); box-shadow:none; } }
      .card.morphing, .card.expanded, .card.collapsing { z-index:50; }
      .card.morphing .cardSurface, .card.expanded .cardSurface, .card.collapsing .cardSurface {
        position:fixed; inset:auto; z-index:60;
        transform-origin:0 0;
        backface-visibility:hidden;
        -webkit-font-smoothing:antialiased;
        will-change:transform;
        /* Geometry is never transitioned with left/top/width/height.
           A compositor-only FLIP transform keeps the first pixel exactly on the hovered card. */
        transition:box-shadow .24s ease, border-color .20s ease, border-radius .24s ease;
      }
      .card.expanded .cardSurface, .card.collapsing .cardSurface {
        border-radius:22px;
        box-shadow:0 30px 90px rgba(0,0,0,.34), 0 0 0 1px rgba(127,127,127,.14);
        border-color:rgba(127,127,127,.30);
      }
      .card.animating .expandedBody {
        opacity:0 !important; transform:translateY(7px) scale(.995) !important;
        pointer-events:none !important; transition:none !important;
      }
      .card.collapsing .expandedBody {
        opacity:0 !important; transform:translateY(6px) scale(.995) !important;
        pointer-events:none !important; transition:opacity .11s ease, transform .14s ease !important;
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

      .preview { padding:0 14px 13px 42px; height:98px; overflow:hidden; transition:opacity .16s ease, transform .24s cubic-bezier(.16,1,.3,1); }
      .previewItem { display:grid; grid-template-columns:34px 1fr; gap:7px; align-items:start; margin-bottom:7px; }
      .previewLabel { font-size:10px; line-height:1.55; font-weight:750; opacity:.42; padding-top:1px; }
      .previewText { font-size:12.3px; line-height:1.48; opacity:.74; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; word-break:break-word; }
      .previewItem.recent .previewText { opacity:.58; -webkit-line-clamp:1; }
      .card.expanded .preview, .card.expanded .loadingPreview, .card.expanded .waitingPreview {
        opacity:0; transform:translateY(-5px) scale(.99); pointer-events:none;
      }

      .waitingPreview { padding:3px 14px 14px 42px; height:98px; display:flex; flex-direction:column; justify-content:center; gap:8px; transition:opacity .16s ease, transform .24s cubic-bezier(.16,1,.3,1); }
      .waitingLine { font-size:11px; opacity:.52; display:flex; align-items:center; gap:7px; }
      .waitingDot { width:7px; height:7px; border-radius:50%; background:currentColor; opacity:.28; }
      .waitingHint { font-size:10.5px; line-height:1.45; opacity:.38; }
      .loadingPreview { padding:1px 14px 14px 42px; height:98px; transition:opacity .16s ease, transform .24s cubic-bezier(.16,1,.3,1); }
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
        position:absolute; left:0; right:0; top:68px; bottom:0;
        padding:0 14px 15px; opacity:0; overflow:hidden; pointer-events:none;
        display:grid; grid-template-columns:minmax(280px,.9fr) minmax(0,2fr); gap:12px;
        transform:translateY(10px) scale(.992);
        transition:opacity .20s ease, transform .34s cubic-bezier(.16,1,.3,1);
      }
      .card.expanded .expandedBody {
        opacity:1; pointer-events:auto; transform:translateY(0) scale(1);
        transition-delay:.14s;
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

      .footer { min-height:64px; padding:11px 16px; border-top:1px solid rgba(127,127,127,.18); display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
      .loadGroup { display:flex; align-items:center; gap:6px; }
      .countSelect { height:40px; min-width:68px; border:0; outline:none; border-radius:12px; padding:0 28px 0 10px; color:inherit; background:rgba(127,127,127,.11); box-shadow:inset 0 0 0 1px rgba(127,127,127,.08); cursor:pointer; }
      .countSelect:hover { background:rgba(127,127,127,.16); }
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
          <div class="brand"><b>Chat Deck</b><span>分批读取 · 本地缓存 · 手动按需加载</span></div>
          <input class="search" placeholder="搜索已加载的标题或正文…" />
          <button class="btn" data-act="selectVisible">选择当前</button>
          <button class="btn close" data-act="close" title="关闭">×</button>
        </header>
        <div class="rateBanner" role="alert" aria-live="assertive">
          <div class="rateInner"><div class="rateIcon">!</div><div class="rateCopy"><b>请求过多，请稍后再试</b><span class="rateDetail">ChatGPT 暂时限制了请求。本地已缓存内容仍可正常浏览。</span></div></div>
        </div>
        <main class="content"><div class="grid"></div></main>
        <div class="focusVeil"></div>
        <footer class="footer">
          <div class="stats">尚未加载</div>
          <div class="loadGroup">
            <button class="btn" data-act="loadCurrent">加载当前页</button>
            <select class="countSelect" aria-label="批量加载数量">
              <option value="10" selected>10</option><option value="30">30</option><option value="50">50</option><option value="100">100</option><option value="all">全部</option>
            </select>
            <button class="btn primary" data-act="loadCount">加载 10 个</button>
            <button class="btn" data-act="loadMore">加载更多列表</button>
          </div>
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
  const loadCurrentBtn = $('[data-act="loadCurrent"]');
  const loadCountBtn = $('[data-act="loadCount"]');
  const countSelect = $('.countSelect');
  const rateBanner = $('.rateBanner');
  const rateDetail = $('.rateDetail');
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
    if (!res.ok) throw new Error(friendlyHttpError(res.status, '登录状态读取'));
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

  function persistRateState() {
    localStorage.setItem('chatdeck:rateLimitUntil', String(state.rateLimitUntil || 0));
    localStorage.setItem('chatdeck:rateLimitHits', String(state.rateLimitHits || 0));
    localStorage.setItem('chatdeck:prefetchDisabledUntil', String(state.prefetchDisabledUntil || 0));
  }

  function friendlyHttpError(status, context = '请求') {
    if (Number(status) === 429) return '请求过多，请稍后再试';
    return `${context}失败 (${status})`;
  }

  function formatCooldown(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    if (sec < 60) return `${sec} 秒`;
    const min = Math.floor(sec / 60);
    const rest = sec % 60;
    return rest ? `${min} 分 ${rest} 秒` : `${min} 分钟`;
  }

  function updateRateBanner() {
    const shared = sharedNumber('chatdeck:rateLimitUntil');
    state.rateLimitUntil = Math.max(state.rateLimitUntil, shared);
    const remain = state.rateLimitUntil - Date.now();
    if (remain > 0) {
      rateBanner.classList.add('show');
      rateDetail.textContent = `ChatGPT 暂时限制了请求，冷却剩余约 ${formatCooldown(remain)}。已暂停批量/自动请求，本地缓存仍可正常浏览；冷却结束后请重新点击加载。`;
    } else {
      rateBanner.classList.remove('show');
      rateDetail.textContent = 'ChatGPT 暂时限制了请求。本地已缓存内容仍可正常浏览。';
    }
    if (typeof updateStats === 'function') updateStats();
  }

  function abortManualBatchForRateLimit() {
    if (!state.manualLoading) return;
    state.queue = state.queue.filter(item => item.source !== 'manual');
    state.manualPendingIds.clear();
    state.manualLoading = false;
    progress.textContent = '请求过多，请稍后再试';
    updateStats();
  }

  function setRateLimit(ms, kind = 'detail') {
    state.rateLimitHits += 1;
    state.rateLimitUntil = Math.max(state.rateLimitUntil, Date.now() + ms);
    // Any 429 disables speculative/background reads for a long while. User-initiated hover reads still work after cooldown.
    state.prefetchDisabledUntil = Math.max(state.prefetchDisabledUntil, Date.now() + PREFETCH_DISABLE_AFTER_429_MS);
    const base = kind === 'list' ? LIST_MIN_INTERVAL_MS : kind === 'mutate' ? MUTATION_MIN_INTERVAL_MS : DETAIL_MIN_INTERVAL_MS;
    state.adaptiveIntervals[kind] = Math.min(15000, Math.max(base, Math.round((state.adaptiveIntervals[kind] || base) * 1.7)));
    persistRateState();
    abortManualBatchForRateLimit();
    updateRateBanner();
    progress.textContent = '请求过多，请稍后再试';
    showToast('请求过多，请稍后再试');
  }

  function sharedNumber(key) {
    const n = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(n) ? n : 0;
  }

  async function reserveRequestSlot(kind) {
    const base = kind === 'list' ? LIST_MIN_INTERVAL_MS : kind === 'mutate' ? MUTATION_MIN_INTERVAL_MS : DETAIL_MIN_INTERVAL_MS;
    const key = `chatdeck:last:${kind}`;
    while (true) {
      const reserve = async () => {
        const now = Date.now();
        const sharedCooldown = sharedNumber('chatdeck:rateLimitUntil');
        state.rateLimitUntil = Math.max(state.rateLimitUntil, sharedCooldown);
        const interval = Math.max(base, state.adaptiveIntervals[kind] || base);
        const readyAt = Math.max(
          state.rateLimitUntil,
          sharedNumber(key) + interval,
          sharedNumber('chatdeck:last:any') + GLOBAL_MIN_INTERVAL_MS
        );
        if (readyAt > now) return readyAt - now;
        localStorage.setItem(key, String(now));
        localStorage.setItem('chatdeck:last:any', String(now));
        state.lastApiAt = now;
        return 0;
      };

      let wait = 0;
      if (navigator.locks?.request) {
        wait = await navigator.locks.request('chatdeck-api-rate-slot', reserve);
      } else {
        wait = await reserve();
      }
      if (wait <= 0) return;
      await sleep(wait + 30 + Math.floor(Math.random() * 220));
    }
  }

  function relaxInterval(kind) {
    const base = kind === 'list' ? LIST_MIN_INTERVAL_MS : kind === 'mutate' ? MUTATION_MIN_INTERVAL_MS : DETAIL_MIN_INTERVAL_MS;
    const current = state.adaptiveIntervals[kind] || base;
    state.adaptiveIntervals[kind] = Math.max(base, Math.round(current * 0.92));
    if (state.rateLimitHits > 0 && Date.now() > state.rateLimitUntil + 30000) {
      state.rateLimitHits -= 1;
      persistRateState();
    }
  }

  async function apiWith429Retry(path, options = {}, maxRetries = MAX_429_RETRIES, kind = 'detail') {
    let attempt = 0;
    while (true) {
      await reserveRequestSlot(kind);
      const res = await api(path, options);
      if (res.status !== 429) {
        if (res.ok) relaxInterval(kind);
        return res;
      }

      const fallback = Math.min(120000, 12000 * (2 ** Math.min(attempt + state.rateLimitHits, 3)));
      const delay = retryAfterMs(res, fallback) + 500 + Math.floor(Math.random() * 1200);
      setRateLimit(delay, kind);
      if (attempt >= maxRetries) return res;
      attempt += 1;
      await sleep(delay);
    }
  }

  let cacheDbPromise = null;
  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(CACHE_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath:'id' });
        };
        req.onsuccess = () => { state.cacheReady = true; resolve(req.result); };
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    }).catch(err => { console.warn('[Chat Deck] IndexedDB cache unavailable', err); return null; });
    return cacheDbPromise;
  }

  async function cacheGet(id) {
    const db = await openCacheDb();
    if (!db) return null;
    return new Promise(resolve => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function cachePut(id, parsed, chat) {
    const db = await openCacheDb();
    if (!db || !parsed?.messages) return;
    const value = {
      id, messages: parsed.messages, createdAt: parsed.createdAt || getListCreatedAt(chat) || 0,
      listUpdatedAt: getListUpdatedAt(chat), cachedAt: Date.now()
    };
    return new Promise(resolve => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  }

  async function cacheDelete(id) {
    const db = await openCacheDb();
    if (!db) return;
    return new Promise(resolve => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).delete(id);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  }

  function getListUpdatedAt(chat) {
    return normalizeTimestamp(chat?.update_time ?? chat?.updateTime ?? chat?.updated_at ?? chat?.updatedAt);
  }

  function cacheIsFresh(cached, chat) {
    if (!cached?.messages?.length) return false;
    const listUpdatedAt = getListUpdatedAt(chat);
    if (listUpdatedAt && cached.listUpdatedAt) return cached.listUpdatedAt + 1000 >= listUpdatedAt;
    return Date.now() - Number(cached.cachedAt || 0) <= CACHE_SOFT_TTL_MS;
  }

  async function hydrateFromCache(chat) {
    if (!chat?.id || state.details.has(chat.id)) return false;
    const cached = await cacheGet(chat.id);
    if (!cacheIsFresh(cached, chat)) return false;
    state.details.set(chat.id, cached.messages);
    if (cached.createdAt) state.createdTimes.set(chat.id, cached.createdAt);
    state.cacheHits += 1;
    return true;
  }

  async function hydrateBatchFromCache(items) {
    await Promise.all(items.map(async chat => {
      if (await hydrateFromCache(chat)) updateCardDetail(chat.id);
    }));
    updateStats();
  }

  async function loadNextBatch(requestedLimit = BATCH_SIZE) {
    if (state.loadingList || (state.offset >= state.total && state.total !== 0)) return;
    state.loadingList = true;
    loadMoreBtn.disabled = true;
    updateStats();
    loadMoreBtn.textContent = '读取中…';
    let loadedCount = 0;
    try {
      const limit = Math.max(1, Math.min(LIST_FETCH_MAX, Number(requestedLimit) || BATCH_SIZE));
      const url = `/backend-api/conversations?offset=${state.offset}&limit=${limit}&order=updated`;
      const res = await apiWith429Retry(url, {}, 0, 'list');
      if (!res.ok) throw new Error(friendlyHttpError(res.status, '列表读取'));
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
      loadedCount = items.length;
      render();
      observeCards();
      hydrateBatchFromCache(items).catch(() => {});
    } catch (err) {
      console.error('[Chat Deck]', err);
      showToast(err.message || '读取失败');
    } finally {
      state.loadingList = false;
      loadMoreBtn.disabled = state.offset >= state.total;
      loadMoreBtn.textContent = state.offset >= state.total && state.total ? '已全部加载' : '加载更多列表';
      updateStats();
      return loadedCount;
    }
  }

  async function ensureListCount(target) {
    const wantAll = target === Infinity;
    let guard = 0;
    while (guard++ < 200) {
      if (!wantAll && state.chats.length >= target) break;
      if (state.total && state.offset >= state.total) break;
      const remaining = wantAll ? LIST_FETCH_MAX : Math.max(1, target - state.chats.length);
      const before = state.offset;
      const got = await loadNextBatch(Math.min(LIST_FETCH_MAX, remaining));
      if (!got || state.offset <= before) break;
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

  function updateCardLoadState(chatId) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(chatId)}"]`);
    if (!card) return;
    const count = card.querySelector('.count');
    const surface = card.querySelector('.cardSurface');
    const msgs = state.details.get(chatId);
    const isLoading = state.loadingIds.has(chatId);
    if (msgs) {
      if (count) count.textContent = `${msgs.length} 条消息`;
      return;
    }
    if (count) count.textContent = isLoading ? '正在读取…' : '正文未缓存';
    const current = surface?.querySelector('.preview, .loadingPreview, .waitingPreview');
    if (current && isLoading && !current.classList.contains('loadingPreview')) {
      const tmp = document.createElement('div'); tmp.innerHTML = loadingPreviewHTML(); current.replaceWith(tmp.firstElementChild);
    } else if (current && !isLoading && current.classList.contains('loadingPreview')) {
      const tmp = document.createElement('div'); tmp.innerHTML = waitingPreviewHTML(chatId); current.replaceWith(tmp.firstElementChild);
    }
    if (card.classList.contains('expanded') && !msgs) setExpandedLoading(card, isLoading);
  }

  async function enqueueDetail(chatId, source = 'background') {
    if (state.details.has(chatId) || state.detailPromises.has(chatId)) return;

    // Always consult persistent cache before creating a network job.
    const chat = state.chats.find(c => c.id === chatId);
    if (chat && await hydrateFromCache(chat)) {
      updateCardDetail(chatId);
      return;
    }

    const existing = state.queue.findIndex(x => x.id === chatId);
    if (existing >= 0) {
      const rank = { hover: 3, manual: 2, background: 1 };
      const item = state.queue[existing];
      if ((rank[source] || 0) > (rank[item.source] || 0)) {
        state.queue.splice(existing, 1);
        // A manually queued item stays part of that batch even when the user hovers it;
        // moving it to the front gives priority without making pointer-out cancel it.
        if (!(source === 'hover' && item.source === 'manual')) item.source = source;
        source === 'hover' ? state.queue.unshift(item) : state.queue.push(item);
      }
      pumpQueue();
      return;
    }

    if (source === 'background') {
      if (Date.now() < state.prefetchDisabledUntil || document.hidden || !state.opened) return;
      const backgroundCount = state.queue.filter(x => x.source === 'background').length;
      if (backgroundCount >= MAX_BACKGROUND_QUEUE) return;
    }
    const item = { id: chatId, source, queuedAt:Date.now() };
    source === 'hover' ? state.queue.unshift(item) : state.queue.push(item);
    pumpQueue();
  }

  function removeBackgroundQueued(chatId) {
    state.queue = state.queue.filter(x => x.id !== chatId || x.source !== 'background');
  }

  function cancelQueuedPriority(chatId) {
    if (state.detailPromises.has(chatId)) return;
    state.queue = state.queue.filter(x => x.id !== chatId || x.source !== 'hover');
    updateCardLoadState(chatId);
  }

  function pumpQueue() {
    clearTimeout(state.queueTimer);
    if (state.activeLoads >= DETAIL_CONCURRENCY || !state.queue.length || !state.opened || document.hidden) return;

    const hoverIndex = state.queue.findIndex(x => x.source === 'hover');
    const manualIndex = state.queue.findIndex(x => x.source === 'manual');
    const index = hoverIndex >= 0 ? hoverIndex : (manualIndex >= 0 ? manualIndex : 0);
    const item = state.queue[index];
    const isBackground = item.source === 'background';
    const isManual = item.source === 'manual';

    if (isBackground) {
      if (Date.now() < state.prefetchDisabledUntil || state.expandedId) {
        state.queue.splice(index, 1);
        pumpQueue();
        return;
      }
      const bgSpacing = BACKGROUND_DETAIL_INTERVAL_MS - (Date.now() - state.lastDetailRequestAt);
      if (bgSpacing > 0) {
        state.queueTimer = setTimeout(pumpQueue, bgSpacing + 50);
        return;
      }
    }

    if (isManual) {
      const manualSpacing = MANUAL_DETAIL_INTERVAL_MS - (Date.now() - state.lastManualRequestAt);
      if (manualSpacing > 0) {
        state.queueTimer = setTimeout(pumpQueue, manualSpacing + 50);
        return;
      }
    }

    state.queue.splice(index, 1);
    const id = item.id;
    const chat = state.chats.find(c => c.id === id);
    state.activeLoads++;
    state.loadingIds.add(id);
    updateCardLoadState(id);

    const p = (async () => {
      try {
        const res = await apiWith429Retry(`/backend-api/conversation/${encodeURIComponent(id)}`, {}, 0, 'detail');
        state.lastDetailRequestAt = Date.now();
        if (isManual) state.lastManualRequestAt = Date.now();
        if (res.status === 429) {
          state.detailErrors.set(id, '请求过多，请稍后再试');
          return;
        }
        if (!res.ok) throw new Error(friendlyHttpError(res.status, '正文读取'));
        const data = await res.json();
        const parsed = parseConversation(data);
        state.details.set(id, parsed.messages);
        state.detailErrors.delete(id);
        if (parsed.createdAt) state.createdTimes.set(id, parsed.createdAt);
        await cachePut(id, parsed, chat);
      } catch (e) {
        state.detailErrors.set(id, e?.message || '读取失败');
      } finally {
        state.detailPromises.delete(id);
        state.loadingIds.delete(id);
        state.activeLoads--;
        if (state.details.has(id)) updateCardDetail(id);
        else updateCardLoadState(id);
        finishManualItem(id, state.details.has(id));
        pumpQueue();
      }
    })();
    state.detailPromises.set(id, p);
  }

  function finishManualItem(id, success) {
    if (!state.manualPendingIds.has(id)) return;
    state.manualPendingIds.delete(id);
    success ? state.manualDone++ : state.manualFailed++;
    const finished = state.manualDone + state.manualFailed;
    progress.textContent = `${state.manualLabel || '读取'} ${finished} / ${state.manualTotal}${state.manualFailed ? ` · 失败 ${state.manualFailed}` : ''}`;
    if (!state.manualPendingIds.size) {
      state.manualLoading = false;
      const failed = state.manualFailed;
      showToast(failed ? `读取完成，${failed} 个失败` : '读取完成');
      updateStats();
      setTimeout(() => { if (!state.manualLoading && Date.now() >= state.rateLimitUntil) progress.textContent = ''; }, 2200);
    }
  }

  async function startManualDetailLoad(ids, label = '读取') {
    if (state.manualLoading) { showToast('已有批量读取任务正在进行'); return; }
    if (Date.now() < Math.max(state.rateLimitUntil, sharedNumber('chatdeck:rateLimitUntil'))) {
      updateRateBanner();
      showToast('请求过多，请稍后再试');
      return;
    }
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) { showToast('当前没有可加载的对话'); return; }

    // Cache lookup is local and does not consume network quota.
    await Promise.all(unique.map(async id => {
      if (state.details.has(id)) return;
      const chat = state.chats.find(c => c.id === id);
      if (chat && await hydrateFromCache(chat)) updateCardDetail(id);
    }));

    const pending = unique.filter(id => !state.details.has(id) && !state.detailPromises.has(id));
    if (!pending.length) { showToast('这些对话已经在本地缓存中'); updateStats(); return; }

    state.manualLoading = true;
    state.manualPendingIds = new Set(pending);
    state.manualDone = 0;
    state.manualFailed = 0;
    state.manualTotal = pending.length;
    state.manualLabel = label;
    progress.textContent = `${label} 0 / ${pending.length}`;

    for (const id of pending) {
      const existing = state.queue.findIndex(x => x.id === id);
      if (existing >= 0) {
        state.queue[existing].source = state.queue[existing].source === 'hover' ? 'hover' : 'manual';
      } else {
        state.queue.push({ id, source:'manual', queuedAt:Date.now() });
      }
    }
    updateStats();
    pumpQueue();
  }

  function visibleCardIds() {
    const viewport = content.getBoundingClientRect();
    return [...grid.querySelectorAll('.card')].filter(card => {
      const r = card.getBoundingClientRect();
      return r.bottom > viewport.top + 2 && r.top < viewport.bottom - 2 && r.right > viewport.left && r.left < viewport.right;
    }).map(card => card.dataset.id).filter(Boolean);
  }

  async function loadCurrentPageDetails() {
    collapseExpanded(true);
    const ids = visibleCardIds();
    await startManualDetailLoad(ids, '当前页');
  }

  async function loadCountDetails() {
    collapseExpanded(true);
    const raw = countSelect.value;
    const wantAll = raw === 'all';
    const count = wantAll ? Infinity : Number(raw || 10);
    loadCountBtn.disabled = true;
    try {
      if (!state.query.trim()) await ensureListCount(count);
      const list = filteredChats();
      const ids = wantAll ? list.map(c => c.id) : list.slice(0, count).map(c => c.id);
      await startManualDetailLoad(ids, wantAll ? '全部读取' : `读取 ${Math.min(count, ids.length)} 个`);
    } finally {
      updateStats();
    }
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

  function waitingPreviewHTML(id) {
    const err = state.detailErrors.get(id);
    return `<div class="waitingPreview">
      <div class="waitingLine"><span class="waitingDot"></span><span>${escapeAttr(err || '悬停 0.5 秒展开并读取对话')}</span></div>
      <div class="waitingHint">未缓存正文不会自动批量请求；可悬停读取，或使用底部“加载当前页 / 加载 N 个”。</div>
    </div>`;
  }

  function setExpandedLoading(card, active = false) {
    const digest = card?.querySelector('.digest');
    const messages = card?.querySelector('.messages');
    if (!digest || !messages) return;
    const id = card.dataset.id;
    const err = state.detailErrors.get(id);
    digest.innerHTML = `<div class="digestHead"><b>对话速览</b><span>${active ? '安全限速读取中' : '等待读取'}</span></div>
      <div class="loadingStatus" style="margin-top:14px">${active ? '<span class="spinner"></span>' : '<span class="waitingDot"></span>'}<span>${escapeAttr(err || (active ? '正在读取并写入本地缓存…' : '即将读取；已缓存的对话以后会直接打开'))}</span></div>
      <div class="skeleton s1"></div><div class="skeleton s2"></div><div class="skeleton s3"></div>`;
    messages.innerHTML = `<div class="moreHint">为降低请求过多的风险，同一时间只读取一个正文；如被限流会立即停止批量请求并显示冷却提示。</div>`;
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
      const count = msgs ? `${msgs.length} 条消息` : (state.loadingIds.has(c.id) ? '正在读取…' : '正文未缓存');
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
          ${msgs ? previewHTML(msgs) : (state.loadingIds.has(c.id) ? loadingPreviewHTML() : waitingPreviewHTML(c.id))}
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
    const oldPreview = surface.querySelector('.preview, .loadingPreview, .waitingPreview');
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
        if (e.isIntersecting) {
          // Network prefetch is disabled by default in v0.5. Persistent cache is hydrated when list metadata arrives.
          if (AUTO_BACKGROUND_PREFETCH) enqueueDetail(id, 'background');
        } else {
          removeBackgroundQueued(id);
        }
      }
    }, { root: content, rootMargin:'0px', threshold:.60 });
    grid.querySelectorAll('.card').forEach(card => observer.observe(card));
  }

  function updateStats() {
    const visible = filteredChats().length;
    const safe = !AUTO_BACKGROUND_PREFETCH ? '自动预读关闭' : (Date.now() < state.prefetchDisabledUntil ? '后台预读已暂停' : '安全预读');
    stats.textContent = `列表 ${state.chats.length}${state.total ? ` / ${state.total}` : ''} · 当前 ${visible} · 缓存命中 ${state.cacheHits} · ${safe} · 已选 ${state.selected.size}`;
    const rateCooling = Date.now() < Math.max(state.rateLimitUntil, sharedNumber('chatdeck:rateLimitUntil'));
    archiveBtn.disabled = deleteBtn.disabled = state.selected.size === 0 || state.working || state.manualLoading || rateCooling;
    loadCurrentBtn.disabled = state.working || state.manualLoading || state.loadingList || rateCooling;
    loadCountBtn.disabled = state.working || state.manualLoading || state.loadingList || rateCooling;
    countSelect.disabled = state.working || state.manualLoading || state.loadingList || rateCooling;
    loadMoreBtn.disabled = state.loadingList || state.manualLoading || rateCooling || (state.total > 0 && state.offset >= state.total);
  }

  function setSurfaceRect(surface, rect) {
    surface.style.left = `${rect.left}px`;
    surface.style.top = `${rect.top}px`;
    surface.style.width = `${rect.width}px`;
    surface.style.height = `${rect.height}px`;
  }

  function rectToTransform(fromRect, layoutRect) {
    const sx = Math.max(.0001, fromRect.width / layoutRect.width);
    const sy = Math.max(.0001, fromRect.height / layoutRect.height);
    const dx = fromRect.left - layoutRect.left;
    const dy = fromRect.top - layoutRect.top;
    return `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;
  }

  function cancelMorphAnimation() {
    const anim = state.morphAnimation;
    state.morphAnimation = null;
    if (!anim) return;
    try { anim.cancel(); } catch (_) {}
  }

  // Freeze the current *visual* pixels before reversing direction. This is important when
  // a mouse-leave happens while the opening animation is still in flight.
  function freezeSurfaceAtCurrentPixels(surface) {
    const visualRect = surface.getBoundingClientRect();
    cancelMorphAnimation();
    surface.style.transition = 'none';
    surface.style.transform = 'none';
    setSurfaceRect(surface, visualRect);
    void surface.offsetWidth;
    surface.style.removeProperty('transition');
    return visualRect;
  }

  function clearMorphStyles(card) {
    if (!card) return;
    const surface = card.querySelector('.cardSurface');
    cancelMorphAnimation();
    card.classList.remove('expanded', 'morphing', 'animating', 'collapsing');
    if (surface) {
      surface.style.removeProperty('left');
      surface.style.removeProperty('top');
      surface.style.removeProperty('width');
      surface.style.removeProperty('height');
      surface.style.removeProperty('transform');
      surface.style.removeProperty('transform-origin');
      surface.style.removeProperty('transition');
    }
  }

  function expandCard(card) {
    if (!card?.isConnected) return;
    clearTimeout(state.collapseTimer);
    const id = card.dataset.id;
    if (state.expandedId === id && card.classList.contains('expanded') && !card.classList.contains('collapsing')) return;
    if (state.expandedId && state.expandedId !== id) collapseExpanded(true);

    const surface = card.querySelector('.cardSurface');
    if (!surface) return;

    // Measure the untouched card first. No fixed-position class exists at this point.
    const startRect = surface.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const gap = 12;
    const targetWidth = Math.min(contentRect.width - 28, startRect.width * 3 + gap * 2);
    const targetHeight = Math.min(contentRect.height - 24, startRect.height * 3 + gap * 2);

    let left = startRect.left - (targetWidth - startRect.width) / 2;
    let top = startRect.top - (targetHeight - startRect.height) / 2;
    left = Math.max(contentRect.left + 10, Math.min(left, contentRect.right - targetWidth - 10));
    top = Math.max(contentRect.top + 10, Math.min(top, contentRect.bottom - targetHeight - 10));
    const targetRect = { left, top, width: targetWidth, height: targetHeight };

    cancelMorphAnimation();
    card.classList.remove('collapsing');
    card.classList.add('morphing', 'expanded', 'animating');
    panel.classList.add('hasExpanded');
    state.expandedId = id;

    // Canonical FLIP: lay the real surface out at its FINAL rect with transitions disabled,
    // then visually invert it back onto the exact hovered card using only transform.
    // This avoids the old auto/0,0 -> startRect transition that looked like a top-left fly-in.
    surface.style.transition = 'none';
    surface.style.transformOrigin = '0 0';
    setSurfaceRect(surface, targetRect);
    const inverted = rectToTransform(startRect, targetRect);
    surface.style.transform = inverted;
    void surface.offsetWidth;
    surface.style.removeProperty('transition');

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof surface.animate !== 'function') {
      surface.style.transform = 'none';
      card.classList.remove('animating');
    } else {
      const anim = surface.animate(
        [
          { transform: inverted },
          { transform: 'translate3d(0,0,0) scale(1,1)' }
        ],
        {
          duration: 500,
          easing: 'cubic-bezier(.16,1,.3,1)',
          fill: 'both'
        }
      );
      state.morphAnimation = anim;
      anim.finished.then(() => {
        if (state.morphAnimation !== anim) return;
        state.morphAnimation = null;
        surface.style.transform = 'none';
        try { anim.cancel(); } catch (_) {}
        if (card.isConnected && state.expandedId === id && !card.classList.contains('collapsing')) {
          card.classList.remove('animating');
        }
      }).catch(() => {});
    }

    if (!state.details.has(id)) setExpandedLoading(card, state.loadingIds.has(id));
    enqueueDetail(id, 'hover');
  }

  function collapseExpanded(immediate = false) {
    clearTimeout(state.hoverTimer);
    clearTimeout(state.collapseTimer);
    const id = state.expandedId;
    if (!id) {
      panel.classList.remove('hasExpanded');
      return;
    }
    const card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    const surface = card?.querySelector('.cardSurface');

    const finish = () => {
      clearMorphStyles(card);
      cancelQueuedPriority(id);
      if (state.expandedId === id) state.expandedId = null;
      panel.classList.remove('hasExpanded');
    };

    if (immediate || !card || !surface) {
      finish();
      return;
    }

    state.collapseTimer = setTimeout(() => {
      if (!card.isConnected || state.expandedId !== id) return;

      // Read the placeholder while it is still untouched in the grid.
      const homeRect = card.getBoundingClientRect();
      // Capture the exact current pixels (even midway through opening), then animate only transform.
      const currentRect = freezeSurfaceAtCurrentPixels(surface);
      card.classList.remove('animating');
      card.classList.add('collapsing');

      const endTransform = rectToTransform(homeRect, currentRect);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || typeof surface.animate !== 'function') {
        finish();
        return;
      }

      const anim = surface.animate(
        [
          { transform: 'translate3d(0,0,0) scale(1,1)' },
          { transform: endTransform }
        ],
        {
          duration: 360,
          easing: 'cubic-bezier(.22,.61,.36,1)',
          fill: 'both'
        }
      );
      state.morphAnimation = anim;
      anim.finished.then(() => {
        if (state.morphAnimation !== anim) return;
        state.morphAnimation = null;
        // The placeholder and transformed surface are now pixel-aligned; restoring absolute
        // positioning happens after the animation, so there is no layout-transition stutter.
        try { anim.cancel(); } catch (_) {}
        finish();
      }).catch(() => {});

      // Safety cleanup if transition events/WAAPI completion are interrupted by the page.
      setTimeout(() => {
        if (state.expandedId === id && card.classList.contains('collapsing')) finish();
      }, 520);
    }, HOVER_COLLAPSE_DELAY_MS);
  }

  async function patchConversation(id, body) {
    const res = await apiWith429Retry(`/backend-api/conversation/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) }, 0, 'mutate');
    if (!res.ok) throw new Error(friendlyHttpError(res.status, '操作'));
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
          state.detailErrors.delete(id);
          cacheDelete(id).catch(() => {});
          render(); observeCards();
        }, 260);
      } catch (e) {
        failed++;
        console.error('[Chat Deck]', id, e);
        if ((e?.message || '') === '请求过多，请稍后再试') {
          progress.textContent = '请求过多，请稍后再试';
          break;
        }
      }
      // No fixed burst loop: the global mutation scheduler reserves a safe cross-tab slot for every request.
    }
    state.working = false;
    const rateStopped = Date.now() < Math.max(state.rateLimitUntil, sharedNumber('chatdeck:rateLimitUntil'));
    progress.textContent = rateStopped ? '请求过多，请稍后再试' : (failed ? `完成 ${ok}，失败 ${failed}` : `完成 ${ok}`);
    showToast(rateStopped ? '请求过多，请稍后再试' : `${label}完成：${ok}${failed ? `，失败 ${failed}` : ''}`);
    updateStats();
    setTimeout(() => { if (!state.working) progress.textContent = ''; }, 2200);
  }

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target.closest('.launcher')) {
      state.opened = true; overlay.classList.add('open'); updateRateBanner();
      if (!state.chats.length) loadNextBatch();
      return;
    }
    if (act === 'close') { collapseExpanded(true); state.opened = false; overlay.classList.remove('open'); return; }
    if (act === 'loadMore') { loadNextBatch(); return; }
    if (act === 'loadCurrent') { loadCurrentPageDetails(); return; }
    if (act === 'loadCount') { loadCountDetails(); return; }
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

  countSelect.addEventListener('change', () => {
    loadCountBtn.textContent = countSelect.value === 'all' ? '加载全部' : `加载 ${countSelect.value} 个`;
  });

  search.addEventListener('input', () => {
    state.query = search.value;
    render(); observeCards();
  });

  let scrollLoadTimer = null;
  content.addEventListener('scroll', () => {
    if (state.expandedId) collapseExpanded(true);
    clearTimeout(scrollLoadTimer);
    if (state.loadingList || state.manualLoading || !state.total || state.offset >= state.total) return;
    if (content.scrollTop + content.clientHeight > content.scrollHeight - 520) {
      scrollLoadTimer = setTimeout(() => loadNextBatch(), 650);
    }
  }, { passive:true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.opened) pumpQueue();
  });

  updateRateBanner();
  setInterval(updateRateBanner, 1000);
  openCacheDb().catch(() => {});

  document.addEventListener('keydown', (e) => {
    if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      state.opened = !state.opened;
      overlay.classList.toggle('open', state.opened);
      if (state.opened) updateRateBanner();
      if (!state.opened) collapseExpanded(true);
      if (state.opened && !state.chats.length) loadNextBatch();
    }
    if (e.key === 'Escape' && state.opened) {
      if (state.expandedId) collapseExpanded(true);
      else { state.opened = false; overlay.classList.remove('open'); }
    }
  });
})();
