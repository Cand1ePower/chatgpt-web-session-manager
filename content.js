(() => {
  if (window.__CGPT_CARD_MANAGER__) return;
  window.__CGPT_CARD_MANAGER__ = true;

  // v1.3 performance pass: lazy expanded DOM + CSS rendering containment.
  const BATCH_SIZE = 24;
  const LIST_FETCH_MAX = 100;
  const DETAIL_CONCURRENCY = 1;
  const DETAIL_MIN_INTERVAL_MS = 900;
  const BACKGROUND_DETAIL_INTERVAL_MS = 9000;
  const LIST_MIN_INTERVAL_MS = 1800;
  const MUTATION_MIN_INTERVAL_MS = 2200;
  const MEDIA_MIN_INTERVAL_MS = 900;
  const GLOBAL_MIN_INTERVAL_MS = 760;
  const LOAD_SPEEDS = Object.freeze({
    slow:   { label:'慢', interval:4500, hint:'更稳妥，适合长批次' },
    normal: { label:'正常', interval:1800, hint:'速度与限流风险平衡' },
    fast:   { label:'快速', interval:900, hint:'明显更快，限流风险更高' },
  });
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
    adaptiveIntervals: { list: LIST_MIN_INTERVAL_MS, detail: DETAIL_MIN_INTERVAL_MS, mutate: MUTATION_MIN_INTERVAL_MS, media: MEDIA_MIN_INTERVAL_MS },
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
    loadCountChoice: '10',
    loadSpeedChoice: localStorage.getItem('chatdeck:loadSpeed') || 'slow',
    countMenuOpen: false,
    speedMenuOpen: false,
    fastWarningOpen: false,
    pendingFastChoice: false,
    pendingFastLoad: false,
    fastConfirmedForSession: false,
    autoExpand: localStorage.getItem('chatdeck:autoExpand') !== '0',
    imageUrlCache: new Map(),
    imagePromises: new Map(),
    imageViewerOpen: false,
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

      .overlay { position: fixed; inset: 0; z-index: 2147483645; display: none; background: rgba(8,8,10,.34); backdrop-filter: blur(3px); }
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
      .modeToggle {
        height:40px; padding:0 10px 0 12px; border:0; border-radius:12px; cursor:pointer; color:inherit;
        background:rgba(127,127,127,.085); box-shadow:inset 0 0 0 1px rgba(127,127,127,.10);
        display:flex; align-items:center; gap:9px; white-space:nowrap; transition:background .18s ease, box-shadow .18s ease, transform .18s ease;
      }
      .modeToggle:hover { background:rgba(127,127,127,.15); transform:translateY(-1px); }
      .modeToggle .modeLabel { font-size:11.5px; font-weight:650; opacity:.72; }
      .modeSwitch {
        width:34px; height:20px; border-radius:999px; padding:2px; position:relative; flex:0 0 auto;
        background:rgba(127,127,127,.22); box-shadow:inset 0 0 0 1px rgba(127,127,127,.15);
        transition:background .22s ease, box-shadow .22s ease;
      }
      .modeSwitch::after {
        content:""; display:block; width:16px; height:16px; border-radius:50%; background:rgba(255,255,255,.92);
        box-shadow:0 1px 4px rgba(0,0,0,.20); transform:translateX(0);
        transition:transform .25s cubic-bezier(.16,1,.3,1), background .18s ease;
      }
      .modeToggle.active .modeSwitch { background:rgba(82,125,255,.72); box-shadow:inset 0 0 0 1px rgba(82,125,255,.34), 0 0 0 3px rgba(82,125,255,.07); }
      .modeToggle.active .modeSwitch::after { transform:translateX(14px); }
      @media (prefers-color-scheme: dark) { .modeSwitch::after { background:#f5f5f6; } }


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
      .card:not(.expanded):not(.morphing):not(.collapsing) { content-visibility:auto; contain-intrinsic-size:170px 320px; }
      .cardSurface {
        position:absolute; inset:0; height:170px; overflow:hidden;
        border-radius:17px; background:rgba(255,255,255,.76); border:1px solid rgba(0,0,0,.08);
        box-shadow:0 4px 18px rgba(0,0,0,.045);
        transition:box-shadow .22s ease, border-color .18s ease, border-radius .28s cubic-bezier(.16,1,.3,1);
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
        transition:box-shadow .18s ease, border-color .16s ease, border-radius .18s ease;
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
      /* Selected cards: continuous clockwise rainbow rim. Only the hue angle moves;
         opacity, glow and shadow stay constant so there is no breathing/fading cycle. */
      @property --selected-rim-angle {
        syntax: "<angle>";
        inherits: false;
        initial-value: 0deg;
      }
      .card.selected .cardSurface {
        outline:none;
        border-color:rgba(112,118,132,.42);
        /* Constant, very subtle halo. Never animated. */
        box-shadow:
          0 8px 28px rgba(0,0,0,.09),
          0 0 0 1px rgba(255,255,255,.28) inset,
          0 0 7px rgba(150,170,205,.12),
          0 0 14px rgba(196,150,184,.055);
      }
      .card.selected .cardSurface::before {
        content:""; position:absolute; inset:-1px; border-radius:inherit; padding:2px; pointer-events:none; z-index:8;
        background:conic-gradient(from var(--selected-rim-angle),
          hsl(350 47% 64%) 0deg,
          hsl(18 48% 65%) 38deg,
          hsl(47 45% 66%) 78deg,
          hsl(86 40% 63%) 116deg,
          hsl(145 41% 61%) 158deg,
          hsl(185 44% 63%) 200deg,
          hsl(220 45% 66%) 240deg,
          hsl(260 43% 68%) 278deg,
          hsl(306 44% 66%) 320deg,
          hsl(350 47% 64%) 360deg);
        -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite:xor; mask-composite:exclude;
        animation:selectedRimSpin 3.35s linear infinite;
        animation-play-state:running;
        animation-fill-mode:both;
        opacity:1;
        transition:none;
        filter:saturate(1.02) contrast(1.035) brightness(1.015)
               drop-shadow(0 0 2.2px rgba(174,184,218,.17));
        will-change:background;
      }
      @keyframes selectedRimSpin {
        0%   { --selected-rim-angle:0deg; opacity:1; }
        25%  { --selected-rim-angle:90deg; opacity:1; }
        50%  { --selected-rim-angle:180deg; opacity:1; }
        75%  { --selected-rim-angle:270deg; opacity:1; }
        100% { --selected-rim-angle:360deg; opacity:1; }
      }
      @media (prefers-color-scheme: dark) {
        .card.selected .cardSurface {
          border-color:rgba(255,255,255,.30);
          box-shadow:
            0 9px 30px rgba(0,0,0,.26),
            0 0 0 1px rgba(255,255,255,.075) inset,
            0 0 8px rgba(151,174,218,.14),
            0 0 16px rgba(206,153,191,.065);
        }
        .card.selected .cardSurface::before {
          background:conic-gradient(from var(--selected-rim-angle),
            hsl(350 48% 69%) 0deg,
            hsl(18 48% 70%) 38deg,
            hsl(47 45% 71%) 78deg,
            hsl(86 41% 67%) 116deg,
            hsl(145 42% 66%) 158deg,
            hsl(185 45% 68%) 200deg,
            hsl(220 46% 71%) 240deg,
            hsl(260 44% 72%) 278deg,
            hsl(306 45% 70%) 320deg,
            hsl(350 48% 69%) 360deg);
          opacity:1;
          filter:saturate(1.02) contrast(1.035) brightness(1.02)
                 drop-shadow(0 0 2.4px rgba(184,196,232,.19));
        }
      }
      /* Do not let loading/hover state add a breathing animation to selected cards. */
      .card.selected.contentLoading .cardSurface { animation:none !important; }
      .card.deleted .cardSurface { opacity:.25; transform:scale(.97); pointer-events:none; }

      /* Loaded conversations get a deliberate finished rim. Unloaded cards stay quiet and use placeholder lines. */
      .card.loaded .cardSurface {
        border-color:rgba(67,67,73,.30);
        box-shadow:0 5px 20px rgba(0,0,0,.055), inset 0 0 0 1px rgba(255,255,255,.42);
      }
      .card.loaded .cardSurface::after {
        content:""; position:absolute; inset:-1px; border-radius:inherit; padding:1.5px; pointer-events:none;
        background:linear-gradient(118deg, rgba(35,35,39,.56) 0%, rgba(110,110,118,.18) 27%, rgba(110,110,118,.06) 53%, rgba(35,35,39,.34) 100%);
        -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite:xor; mask-composite:exclude;
        opacity:.70; transition:opacity .18s ease, filter .18s ease;
      }
      .card.loaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover {
        border-color:rgba(48,48,54,.40);
        box-shadow:0 10px 28px rgba(0,0,0,.08), inset 0 0 0 1px rgba(255,255,255,.52);
      }
      .card.loaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover::after { opacity:.94; filter:contrast(1.08); }
      .card.unloaded .cardSurface {
        border-color:rgba(108,108,112,.13);
        box-shadow:0 3px 14px rgba(0,0,0,.028);
      }
      .card.unloaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover {
        border-color:rgba(92,92,98,.22); box-shadow:0 7px 22px rgba(0,0,0,.05);
      }
      .card.contentLoading .cardSurface {
        border-color:rgba(92,92,98,.34);
        animation:loadingEdgePulse 1.05s ease-in-out infinite alternate;
      }
      @keyframes loadingEdgePulse {
        from { box-shadow:0 3px 14px rgba(0,0,0,.025) }
        to { box-shadow:0 8px 26px rgba(0,0,0,.075), inset 0 0 0 1px rgba(127,127,127,.12) }
      }
      @media (prefers-color-scheme: dark) {
        .card.loaded .cardSurface {
          border-color:rgba(255,255,255,.24);
          box-shadow:0 5px 22px rgba(0,0,0,.16), inset 0 0 0 1px rgba(255,255,255,.075);
        }
        .card.loaded .cardSurface::after {
          background:linear-gradient(118deg, rgba(255,255,255,.64) 0%, rgba(255,255,255,.18) 29%, rgba(255,255,255,.055) 55%, rgba(255,255,255,.34) 100%);
          opacity:.76;
        }
        .card.loaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover {
          border-color:rgba(255,255,255,.32);
          box-shadow:0 10px 32px rgba(0,0,0,.24), inset 0 0 0 1px rgba(255,255,255,.10);
        }
        .card.unloaded .cardSurface { border-color:rgba(255,255,255,.075); box-shadow:none; }
        .card.unloaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover { border-color:rgba(255,255,255,.13); box-shadow:0 8px 24px rgba(0,0,0,.14); }
      }

      /* Selected state wins over loaded/unloaded/hover rules declared above. */
      .card.selected.loaded .cardSurface,
      .card.selected.unloaded .cardSurface,
      .card.selected.loaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover,
      .card.selected.unloaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover {
        border-color:rgba(112,118,132,.42);
        box-shadow:
          0 8px 28px rgba(0,0,0,.09),
          0 0 0 1px rgba(255,255,255,.28) inset,
          0 0 7px rgba(150,170,205,.12),
          0 0 14px rgba(196,150,184,.055);
      }
      @media (prefers-color-scheme: dark) {
        .card.selected.loaded .cardSurface,
        .card.selected.unloaded .cardSurface,
        .card.selected.loaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover,
        .card.selected.unloaded:not(.expanded):not(.morphing):not(.collapsing) .cardSurface:hover {
          border-color:rgba(255,255,255,.30);
          box-shadow:
            0 9px 30px rgba(0,0,0,.26),
            0 0 0 1px rgba(255,255,255,.075) inset,
            0 0 8px rgba(151,174,218,.14),
            0 0 16px rgba(206,153,191,.065);
        }
      }

      .focusVeil {
        position:absolute; left:0; right:0; top:76px; bottom:64px; z-index:20;
        opacity:0; pointer-events:none;
        background:rgba(20,20,22,.025);
        backdrop-filter: blur(.8px) saturate(.98);
        -webkit-backdrop-filter: blur(.8px) saturate(.98);
        transition:opacity .16s ease;
      }
      .panel.hasExpanded .focusVeil { opacity:1; pointer-events:auto; }
      @media (prefers-color-scheme: dark) { .focusVeil { background:rgba(0,0,0,.055); } }

      .cardHead { padding:14px 14px 10px; display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:start; }
      .check { width:18px; height:18px; margin:2px 0 0; accent-color:#111; cursor:pointer; }
      .titleWrap { min-width:0; }
      .title { font-size:14px; line-height:1.35; font-weight:680; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
      .meta { display:flex; gap:7px; margin-top:6px; font-size:11px; opacity:.62; white-space:nowrap; overflow:hidden; align-items:center; }
      .meta .createdAt { overflow:hidden; text-overflow:ellipsis; }
      .contentState {
        display:inline-flex; align-items:center; gap:5px; flex:0 0 auto; height:20px; padding:0 7px; margin-left:1px;
        border-radius:999px; font-size:9.8px; font-weight:720; letter-spacing:.01em; opacity:1;
        background:rgba(127,127,127,.105); box-shadow:inset 0 0 0 1px rgba(127,127,127,.12);
      }
      .contentState i { width:6px; height:6px; border-radius:50%; background:currentColor; opacity:.38; }
      .contentState.pending, .contentState.ready { display:none; }
      .contentState.loading { background:rgba(127,127,127,.17); box-shadow:inset 0 0 0 1px rgba(127,127,127,.24); }
      .contentState.loading i { opacity:.85; animation:statePulse .78s ease-in-out infinite alternate; }
      .metaSep.hidden, .count.hidden { display:none; }
      @keyframes statePulse { from { transform:scale(.72); opacity:.38 } to { transform:scale(1.2); opacity:1 } }
      .mini { border:0; background:transparent; color:inherit; width:32px; height:32px; border-radius:10px; cursor:pointer; opacity:.62; transition:background .16s ease, opacity .16s ease, transform .16s cubic-bezier(.2,.8,.2,1); }
      .mini:hover { background:rgba(127,127,127,.12); opacity:1; transform:translateY(-1px) scale(1.035); }

      .preview { padding:0 14px 13px 42px; height:98px; overflow:hidden; transition:opacity .13s ease, transform .18s cubic-bezier(.16,1,.3,1); }
      .previewItem { display:grid; grid-template-columns:34px 1fr; gap:7px; align-items:start; margin-bottom:7px; }
      .previewLabel { font-size:10px; line-height:1.55; font-weight:750; opacity:.42; padding-top:1px; }
      .previewText { font-size:12.3px; line-height:1.48; opacity:.74; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; word-break:break-word; }
      .previewItem.recent .previewText { opacity:.58; -webkit-line-clamp:1; }
      .card.expanded .preview, .card.expanded .loadingPreview, .card.expanded .waitingPreview {
        opacity:0; transform:translateY(-5px) scale(.99); pointer-events:none;
      }

      .waitingPreview {
        padding:18px 14px 14px 42px; height:98px; display:flex; flex-direction:column;
        justify-content:flex-start; gap:10px; transition:opacity .13s ease, transform .18s cubic-bezier(.16,1,.3,1);
      }
      .placeholderLine {
        height:8px; flex:0 0 8px; border-radius:999px;
        background:linear-gradient(90deg, rgba(127,127,127,.075) 0%, rgba(127,127,127,.18) 46%, rgba(127,127,127,.095) 100%);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.08); opacity:.72;
        transition:opacity .18s ease, transform .18s ease;
      }
      .placeholderLine.p1 { width:86%; }
      .placeholderLine.p2 { width:68%; }
      .placeholderLine.p3 { width:45%; }
      .card.unloaded:not(.contentLoading):hover .placeholderLine { opacity:.90; transform:translateX(1px); }
      .waitingDot { width:8px; height:8px; border-radius:50%; background:transparent; border:1.5px solid currentColor; opacity:.42; box-shadow:0 0 0 3px rgba(127,127,127,.07); }
      @media (prefers-color-scheme: dark) {
        .placeholderLine {
          background:linear-gradient(90deg, rgba(255,255,255,.055) 0%, rgba(255,255,255,.14) 46%, rgba(255,255,255,.072) 100%);
          box-shadow:none;
        }
      }
      .loadingPreview { padding:1px 14px 14px 42px; height:98px; transition:opacity .13s ease, transform .18s cubic-bezier(.16,1,.3,1); }
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
        transition:opacity .16s ease, transform .24s cubic-bezier(.16,1,.3,1);
      }
      .card.expanded .expandedBody {
        opacity:1; pointer-events:auto; transform:translateY(0) scale(1);
        transition-delay:.08s;
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
      .msgBody { position:relative; max-height:none; overflow:visible; }
      .msgBody.long:not(.open) { max-height:156px; overflow:hidden; }
      .msgBody.long:not(.open)::after { content:""; position:absolute; left:0; right:0; bottom:0; height:28px; background:linear-gradient(transparent, rgba(127,127,127,.11)); pointer-events:none; }
      .msgBody.open { max-height:none; }
      .msgToggle { border:0; padding:3px 0 0; background:transparent; color:inherit; cursor:pointer; font-size:10px; opacity:.55; }
      .msgToggle:hover { opacity:.9; }
      .moreHint { padding:8px; text-align:center; font-size:10.5px; opacity:.42; }

      .listSentinel {
        height:0; overflow:hidden; display:flex; align-items:center; justify-content:center; gap:8px;
        font-size:10.8px; opacity:0; transform:translateY(4px); transition:height .22s ease, opacity .18s ease, transform .22s cubic-bezier(.16,1,.3,1);
      }
      .listSentinel.show { height:42px; opacity:.58; transform:translateY(0); }
      .listDots { display:flex; gap:3px; align-items:center; }
      .listDots i { width:4px; height:4px; border-radius:50%; background:currentColor; opacity:.35; animation:listDot .9s ease-in-out infinite alternate; }
      .listDots i:nth-child(2) { animation-delay:.14s; } .listDots i:nth-child(3) { animation-delay:.28s; }
      @keyframes listDot { to { transform:translateY(-3px); opacity:.9 } }

      .footer { min-height:64px; padding:11px 16px; border-top:1px solid rgba(127,127,127,.18); display:flex; align-items:center; gap:9px; flex-wrap:wrap; overflow:visible; }
      .loadGroup { display:flex; align-items:center; gap:8px; position:relative; }
      .loadCombo { position:relative; display:flex; align-items:stretch; min-width:222px; height:42px; border-radius:13px; background:rgba(127,127,127,.10); box-shadow:inset 0 0 0 1px rgba(127,127,127,.11), 0 3px 12px rgba(0,0,0,.025); transition:background .18s ease, box-shadow .18s ease, transform .18s ease; }
      .loadCombo:hover { background:rgba(127,127,127,.14); box-shadow:inset 0 0 0 1px rgba(127,127,127,.17), 0 5px 16px rgba(0,0,0,.045); }
      .loadCombo.busy { background:rgba(127,127,127,.13); }
      .loadCountBtn {
        min-width:0; flex:1; border:0; background:transparent; color:inherit; cursor:pointer; border-radius:13px 0 0 13px;
        padding:0 12px; display:flex; align-items:center; gap:9px; text-align:left; font-weight:650;
      }
      .loadCountBtn:disabled, .countToggle:disabled { opacity:.42; cursor:not-allowed; }
      .loadOrb { width:9px; height:9px; border-radius:50%; flex:0 0 auto; border:1.5px solid currentColor; opacity:.45; transition:.2s ease; }
      .loadCombo:hover .loadOrb { opacity:.75; transform:scale(1.08); }
      .loadCombo.busy .loadOrb { border-top-color:transparent; opacity:.8; animation:spin .72s linear infinite; }
      .loadButtonCopy { min-width:0; display:flex; flex-direction:column; line-height:1.12; }
      .loadButtonCopy b { font-size:11.5px; font-weight:700; white-space:nowrap; }
      .loadButtonCopy span { margin-top:3px; font-size:9.5px; font-weight:500; opacity:.48; white-space:nowrap; }
      .countToggle { width:40px; flex:0 0 40px; border:0; border-left:1px solid rgba(127,127,127,.13); background:transparent; color:inherit; cursor:pointer; border-radius:0 13px 13px 0; display:grid; place-items:center; }
      .chevron { width:8px; height:8px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(45deg) translate(-1px,-1px); opacity:.55; transition:transform .28s cubic-bezier(.16,1,.3,1), opacity .18s ease; }
      .loadCombo.menuOpen .chevron { transform:rotate(225deg) translate(-1px,-1px); opacity:.9; }
      .countMenu {
        position:absolute; z-index:140; right:0; bottom:calc(100% + 9px); width:222px; padding:6px;
        border-radius:15px; border:1px solid rgba(127,127,127,.18); background:rgba(248,248,247,.96);
        box-shadow:0 18px 50px rgba(0,0,0,.18); backdrop-filter:blur(22px); -webkit-backdrop-filter:blur(22px);
        opacity:0; visibility:hidden; pointer-events:none; transform:translateY(8px) scale(.96); transform-origin:85% 100%;
        transition:opacity .16s ease, transform .26s cubic-bezier(.16,1,.3,1), visibility 0s linear .26s;
      }
      .loadCombo.menuOpen .countMenu { opacity:1; visibility:visible; pointer-events:auto; transform:translateY(0) scale(1); transition:opacity .16s ease, transform .26s cubic-bezier(.16,1,.3,1), visibility 0s; }
      @media (prefers-color-scheme: dark) { .countMenu { background:rgba(34,34,36,.97); border-color:rgba(255,255,255,.12); } }
      .countOption {
        width:100%; min-height:38px; padding:7px 9px; border:0; border-radius:10px; color:inherit; background:transparent; cursor:pointer;
        display:grid; grid-template-columns:1fr auto; align-items:center; gap:8px; text-align:left; transition:background .14s ease, transform .14s ease;
      }
      .countOption:hover { background:rgba(127,127,127,.12); transform:translateX(2px); }
      .countOption .optionCopy { display:flex; flex-direction:column; min-width:0; }
      .countOption b { font-size:11.5px; font-weight:680; }
      .countOption small { margin-top:2px; font-size:9.4px; opacity:.44; }
      .countOption .optionCheck { width:17px; height:17px; border-radius:50%; display:grid; place-items:center; font-size:10px; opacity:0; transform:scale(.6); background:rgba(127,127,127,.14); transition:.16s ease; }
      .countOption.active { background:rgba(127,127,127,.09); }
      .countOption.active .optionCheck { opacity:.75; transform:scale(1); }
      .stats { margin-right:auto; font-size:12px; opacity:.62; }
      .progress { font-size:12px; min-width:150px; text-align:right; opacity:.66; transition:opacity .18s ease; }
      .toolbarSep { width:1px; height:26px; background:rgba(127,127,127,.18); }
      .toast { position:absolute; z-index:90; left:50%; bottom:78px; transform:translateX(-50%) translateY(12px); padding:10px 13px; border-radius:12px; background:#171719; color:#fff; font-size:12px; opacity:0; pointer-events:none; transition:.22s ease; box-shadow:0 10px 34px rgba(0,0,0,.25); }
      .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
      @media (prefers-color-scheme: dark) { .toast { background:#f2f2f3; color:#151517; } }


      /* v1.0 polish ------------------------------------------------------- */
      .content, .messages, .digest, .countMenu, .speedMenu {
        scrollbar-width:thin;
        scrollbar-color:rgba(127,127,127,.34) transparent;
      }
      .content::-webkit-scrollbar { width:10px; }
      .messages::-webkit-scrollbar, .digest::-webkit-scrollbar, .countMenu::-webkit-scrollbar, .speedMenu::-webkit-scrollbar { width:8px; }
      .content::-webkit-scrollbar-track, .messages::-webkit-scrollbar-track, .digest::-webkit-scrollbar-track,
      .countMenu::-webkit-scrollbar-track, .speedMenu::-webkit-scrollbar-track { background:transparent; }
      .content::-webkit-scrollbar-thumb, .messages::-webkit-scrollbar-thumb, .digest::-webkit-scrollbar-thumb,
      .countMenu::-webkit-scrollbar-thumb, .speedMenu::-webkit-scrollbar-thumb {
        background:rgba(127,127,127,.26); border-radius:999px; border:2px solid transparent; background-clip:padding-box;
      }
      .content::-webkit-scrollbar-thumb:hover, .messages::-webkit-scrollbar-thumb:hover, .digest::-webkit-scrollbar-thumb:hover,
      .countMenu::-webkit-scrollbar-thumb:hover, .speedMenu::-webkit-scrollbar-thumb:hover { background:rgba(127,127,127,.46); background-clip:padding-box; }

      .checkWrap { width:20px; height:20px; margin-top:1px; display:grid; place-items:center; cursor:pointer; position:relative; }
      .checkWrap .check { position:absolute; opacity:0; width:1px; height:1px; pointer-events:none; }
      .checkBox {
        width:18px; height:18px; display:grid; place-items:center; border-radius:6px;
        border:1px solid rgba(127,127,127,.38); background:rgba(127,127,127,.055);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.15); transition:transform .15s cubic-bezier(.2,.8,.2,1), background .15s ease, border-color .15s ease, box-shadow .15s ease;
      }
      .checkBox svg { width:11px; height:11px; opacity:0; transform:scale(.55); transition:opacity .13s ease, transform .16s cubic-bezier(.2,.8,.2,1); }
      .checkWrap:hover .checkBox { border-color:rgba(127,127,127,.62); background:rgba(127,127,127,.10); transform:translateY(-1px); }
      .check:checked + .checkBox { background:currentColor; border-color:currentColor; box-shadow:0 3px 10px rgba(0,0,0,.13); }
      .check:checked + .checkBox svg { opacity:1; transform:scale(1); color:var(--check-ink,#fff); }
      @media (prefers-color-scheme: dark) { .check:checked + .checkBox { --check-ink:#171719; background:#f0f0f2; border-color:#f0f0f2; } }
      .check:focus-visible + .checkBox { outline:2px solid currentColor; outline-offset:2px; }

      .cardActions { display:flex; gap:3px; align-items:center; margin-top:-3px; margin-right:-3px; }
      .mini { display:grid; place-items:center; }
      .mini svg { width:16.5px; height:16.5px; stroke:currentColor; fill:none; stroke-width:1.75; stroke-linecap:round; stroke-linejoin:round; }
      .mini.jump:hover { background:rgba(80,110,180,.12); }
      .mini.trash:hover { background:rgba(220,38,38,.12); color:#c92b2b; }

      /* v1.1: return to the v0.9 real-surface FLIP. The same cardSurface is promoted to fixed
         positioning and visually inverted onto its original pixels before it grows outward.
         No detached proxy is used, so the animation always originates from the hovered card. */
      .card.morphing .cardSurface, .card.expanded .cardSurface, .card.collapsing .cardSurface {
        transform-origin:0 0; backface-visibility:hidden; -webkit-font-smoothing:antialiased;
        will-change:transform; contain:paint;
      }
      .card.expanded:not(.animating):not(.collapsing) .cardSurface { will-change:auto; }

      .msg { white-space:normal; }
      .msgBody { line-height:1.58; }
      .md > :first-child { margin-top:0 !important; }
      .md > :last-child { margin-bottom:0 !important; }
      .md p { margin:.4em 0 .72em; }
      .md h1,.md h2,.md h3,.md h4 { margin:.75em 0 .4em; line-height:1.3; letter-spacing:-.01em; }
      .md h1 { font-size:1.28em; } .md h2 { font-size:1.18em; } .md h3 { font-size:1.08em; } .md h4 { font-size:1em; }
      .md ul,.md ol { margin:.45em 0 .75em; padding-left:1.45em; }
      .md li { margin:.2em 0; }
      .md blockquote { margin:.55em 0; padding:.18em .8em; border-left:3px solid rgba(127,127,127,.34); opacity:.84; background:rgba(127,127,127,.045); border-radius:0 8px 8px 0; }
      .md code { padding:.12em .34em; border-radius:5px; font:500 .92em/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; background:rgba(127,127,127,.12); }
      .md pre { margin:.65em 0; padding:10px 11px; border-radius:10px; overflow:auto; background:rgba(18,18,20,.92); color:#f3f3f4; border:1px solid rgba(127,127,127,.18); white-space:pre; }
      .md pre code { padding:0; background:none; color:inherit; font-size:11.4px; }
      .md a { color:inherit; text-decoration:underline; text-underline-offset:2px; opacity:.88; }
      .md img, .mdInlineImage { display:block; max-width:100%; max-height:280px; object-fit:contain; margin:.55em 0; border-radius:10px; border:1px solid rgba(127,127,127,.14); }
      .md strong { font-weight:720; }
      .md hr { border:0; height:1px; background:rgba(127,127,127,.18); margin:.8em 0; }
      .md table { width:100%; border-collapse:collapse; margin:.65em 0; font-size:.94em; }
      .md th,.md td { border:1px solid rgba(127,127,127,.18); padding:5px 7px; text-align:left; vertical-align:top; }
      .md th { background:rgba(127,127,127,.08); font-weight:700; }

      .mediaGrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:7px; margin-top:8px; }
      .mediaTile { position:relative; cursor:zoom-in; aspect-ratio:4/3; min-height:82px; border-radius:10px; overflow:hidden; background:rgba(127,127,127,.10); border:1px solid rgba(127,127,127,.12); }
      .mediaTile img { width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .18s ease, transform .22s ease; }
      .mediaTile.loaded img { opacity:1; }
      .mediaTile:hover img { transform:scale(1.025); }
      .mediaTile .imageSkeleton { position:absolute; inset:0; background:linear-gradient(105deg, rgba(127,127,127,.07) 22%, rgba(127,127,127,.18) 42%, rgba(127,127,127,.07) 62%); background-size:220% 100%; animation:shimmer 1.25s ease-in-out infinite; }
      .mediaTile.loaded .imageSkeleton { display:none; }
      .mediaTile.failed::after { content:"图片暂不可用"; position:absolute; inset:0; display:grid; place-items:center; font-size:10px; opacity:.45; }
      .mediaTile.failed .imageSkeleton { display:none; }
      .compactMedia { position:absolute; right:13px; bottom:12px; width:38px; height:30px; border-radius:8px; overflow:hidden; border:1px solid rgba(127,127,127,.18); background:rgba(127,127,127,.10); opacity:.72; display:none; }
      .compactMedia.show { display:block; }
      .card.expanded .compactMedia { display:none !important; }
      .compactMedia img { width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .18s ease; }
      .compactMedia.loaded img { opacity:1; }
      .compactMedia[data-url] { cursor:zoom-in; }

      .imageViewer {
        position:fixed; inset:0; z-index:2147483647; display:none; place-items:center; padding:32px;
        background:rgba(5,5,7,.68); backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);
        opacity:0; transition:opacity .18s ease; cursor:zoom-out; overflow:hidden;
      }
      .imageViewer.show { display:grid; opacity:1; animation:imageViewerIn .2s cubic-bezier(.16,1,.3,1); }
      @keyframes imageViewerIn { from { opacity:0; } to { opacity:1; } }
      .imageViewerFrame {
        width:min(60vw, calc(100vw - 64px), 1280px);
        height:min(60vh, calc(100vh - 64px), 860px);
        max-width:calc(100vw - 64px); max-height:calc(100vh - 64px);
        display:flex; align-items:center; justify-content:center;
        border-radius:18px; position:relative; cursor:zoom-out; overflow:visible;
      }
      .imageViewerImage {
        display:block;
        width:auto !important; height:auto !important;
        max-width:min(60vw, calc(100vw - 64px), 1280px) !important;
        max-height:min(60vh, calc(100vh - 64px), 860px) !important;
        object-fit:contain !important; object-position:center center;
        border-radius:14px; cursor:default; user-select:none; -webkit-user-drag:none;
        box-shadow:0 28px 90px rgba(0,0,0,.46), 0 0 0 1px rgba(255,255,255,.09);
        opacity:0; transform:scale(.965); transition:opacity .18s ease, transform .24s cubic-bezier(.16,1,.3,1);
      }
      .imageViewerImage.loaded { opacity:1; transform:scale(1); }
      .imageViewerLoader {
        position:absolute; width:34px; height:34px; border-radius:50%; border:3px solid rgba(255,255,255,.18);
        border-top-color:rgba(255,255,255,.88); animation:spin .8s linear infinite; pointer-events:none;
      }
      .imageViewer.loaded .imageViewerLoader { display:none; }
      .imageViewerHint {
        position:absolute; left:50%; bottom:18px; transform:translateX(-50%); padding:7px 11px; border-radius:999px;
        background:rgba(20,20,23,.55); color:rgba(255,255,255,.78); font-size:11px; line-height:1;
        backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); pointer-events:none; white-space:nowrap;
      }

      .loadCombo { min-width:214px; }
      .loadCountBtn { gap:0; padding-left:13px; }
      .loadButtonCopy b { font-size:12px; }
      .loadSpeedMeta { margin-top:3px; font-size:9.5px; font-weight:520; opacity:.5; white-space:nowrap; }
      .countMenu { width:244px; overflow:visible; }
      .menuDivider { height:1px; margin:5px 4px; background:rgba(127,127,127,.14); }
      .menuSectionLabel { padding:4px 9px 5px; font-size:9px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; opacity:.34; }
      .speedEntry { position:relative; }
      .speedOptionTrigger { width:100%; min-height:40px; padding:7px 9px; border:0; border-radius:10px; color:inherit; background:transparent; cursor:pointer; display:grid; grid-template-columns:1fr auto; align-items:center; gap:8px; text-align:left; transition:.14s ease; }
      .speedOptionTrigger:hover, .speedEntry.open .speedOptionTrigger { background:rgba(127,127,127,.11); }
      .speedOptionTrigger b { font-size:11.5px; font-weight:680; }
      .speedCurrent { font-size:10px; opacity:.54; display:flex; align-items:center; gap:7px; }
      .speedCurrent::after { content:"›"; font-size:17px; line-height:1; opacity:.6; }
      .speedMenu {
        position:absolute; left:calc(100% + 8px); bottom:-6px; width:212px; padding:6px; border-radius:14px;
        border:1px solid rgba(127,127,127,.18); background:rgba(248,248,247,.98); box-shadow:0 18px 50px rgba(0,0,0,.18);
        backdrop-filter:blur(22px); -webkit-backdrop-filter:blur(22px); opacity:0; visibility:hidden; pointer-events:none;
        transform:translateX(-7px) scale(.96); transform-origin:0 85%; transition:opacity .14s ease, transform .22s cubic-bezier(.16,1,.3,1), visibility 0s linear .22s;
      }
      .speedEntry.open .speedMenu { opacity:1; visibility:visible; pointer-events:auto; transform:translateX(0) scale(1); transition:opacity .14s ease, transform .22s cubic-bezier(.16,1,.3,1), visibility 0s; }
      @media (prefers-color-scheme: dark) { .speedMenu { background:rgba(34,34,36,.98); border-color:rgba(255,255,255,.12); } }
      .speedChoice { width:100%; min-height:44px; padding:7px 9px; border:0; border-radius:10px; color:inherit; background:transparent; cursor:pointer; display:grid; grid-template-columns:1fr auto; gap:8px; text-align:left; transition:.14s ease; }
      .speedChoice:hover { background:rgba(127,127,127,.11); transform:translateX(2px); }
      .speedChoice b { display:block; font-size:11.5px; }
      .speedChoice small { display:block; margin-top:2px; font-size:9.3px; opacity:.43; }
      .speedChoice .optionCheck { align-self:center; width:17px; height:17px; border-radius:50%; display:grid; place-items:center; background:rgba(127,127,127,.14); opacity:0; transform:scale(.7); transition:.15s ease; font-size:10px; }
      .speedChoice.active { background:rgba(127,127,127,.08); }
      .speedChoice.active .optionCheck { opacity:.78; transform:scale(1); }

      .confirmVeil { position:absolute; inset:0; z-index:220; display:none; align-items:center; justify-content:center; padding:20px; background:rgba(10,10,12,.24); backdrop-filter:blur(5px); }
      .confirmVeil.show { display:flex; animation:fadeIn .14s ease-out; }
      .confirmBox { width:min(420px,calc(100% - 30px)); padding:18px; border-radius:18px; color:inherit; background:rgba(248,248,247,.98); border:1px solid rgba(127,127,127,.18); box-shadow:0 24px 70px rgba(0,0,0,.28); }
      @media (prefers-color-scheme: dark) { .confirmBox { background:rgba(31,31,33,.98); border-color:rgba(255,255,255,.12); } }
      .confirmIcon { width:36px; height:36px; border-radius:11px; display:grid; place-items:center; margin-bottom:11px; background:rgba(220,120,40,.12); color:#b45b12; font-weight:800; }
      .confirmBox h3 { margin:0; font-size:15px; }
      .confirmBox p { margin:8px 0 15px; font-size:12px; line-height:1.58; opacity:.68; }
      .confirmActions { display:flex; justify-content:flex-end; gap:8px; }
      .btn.warn { background:rgba(220,120,40,.13); color:#a84d08; }
      .btn.warn:hover { background:rgba(220,120,40,.20); }

    </style>
    <button class="launcher" title="ChatGPT 对话卡片管理器" aria-label="打开对话管理器"><span class="gridIcon"><i></i><i></i><i></i><i></i></span></button>
    <div class="overlay">
      <section class="panel">
        <header class="topbar">
          <div class="brand"><b>Chat Deck</b><span>分批读取 · 本地缓存 · 手动按需加载</span></div>
          <input class="search" placeholder="搜索已加载的标题或正文…" />
          <button class="modeToggle" data-act="toggleAutoExpand" type="button" aria-pressed="true" title="切换卡片展开方式"><span class="modeLabel">自动展开</span><span class="modeSwitch" aria-hidden="true"></span></button>
          <button class="btn" data-act="selectVisible">选择当前</button>
          <button class="btn close" data-act="close" title="关闭">×</button>
        </header>
        <div class="rateBanner" role="alert" aria-live="assertive">
          <div class="rateInner"><div class="rateIcon">!</div><div class="rateCopy"><b>请求过多，请稍后再试</b><span class="rateDetail">ChatGPT 暂时限制了请求。本地已缓存内容仍可正常浏览。</span></div></div>
        </div>
        <main class="content"><div class="grid"></div><div class="listSentinel" aria-live="polite"><span class="listDots"><i></i><i></i><i></i></span><span>正在继续加载卡片列表…</span></div></main>
        <div class="focusVeil"></div>
        <footer class="footer">
          <div class="stats">尚未加载</div>
          <div class="loadGroup">
            <div class="loadCombo">
              <button class="loadCountBtn" data-act="loadCount" type="button" title="从尚未读取正文的卡片开始继续加载">
                <span class="loadButtonCopy"><b class="loadCountLabel">加载 10 个</b><span class="loadSpeedMeta">慢速 · 已加载自动跳过</span></span>
              </button>
              <button class="countToggle" data-act="toggleCountMenu" type="button" aria-label="加载设置" aria-expanded="false"><span class="chevron"></span></button>
              <div class="countMenu" role="menu" aria-label="批量加载设置">
                <div class="menuSectionLabel">加载数量</div>
                <button class="countOption active" data-count="10" role="menuitem" type="button"><span class="optionCopy"><b>10 个</b><small>处理一小批对话</small></span><span class="optionCheck">✓</span></button>
                <button class="countOption" data-count="30" role="menuitem" type="button"><span class="optionCopy"><b>30 个</b><small>适合连续整理</small></span><span class="optionCheck">✓</span></button>
                <button class="countOption" data-count="50" role="menuitem" type="button"><span class="optionCopy"><b>50 个</b><small>中等批次</small></span><span class="optionCheck">✓</span></button>
                <button class="countOption" data-count="100" role="menuitem" type="button"><span class="optionCopy"><b>100 个</b><small>较长批次</small></span><span class="optionCheck">✓</span></button>
                <button class="countOption" data-count="all" role="menuitem" type="button"><span class="optionCopy"><b>全部</b><small>读取剩余全部对话</small></span><span class="optionCheck">✓</span></button>
                <div class="menuDivider"></div>
                <div class="speedEntry">
                  <button class="speedOptionTrigger" data-act="toggleSpeedMenu" role="menuitem" type="button"><span><b>加载速度</b></span><span class="speedCurrent">慢</span></button>
                  <div class="speedMenu" role="menu" aria-label="选择加载速度">
                    <button class="speedChoice active" data-speed="slow" type="button"><span><b>慢</b><small>当前方案，更稳妥</small></span><span class="optionCheck">✓</span></button>
                    <button class="speedChoice" data-speed="normal" type="button"><span><b>正常</b><small>约 1.8 秒 / 条</small></span><span class="optionCheck">✓</span></button>
                    <button class="speedChoice" data-speed="fast" type="button"><span><b>快速</b><small>约 0.9 秒 / 条，有限流风险</small></span><span class="optionCheck">✓</span></button>
                  </div>
                </div>
              </div>
            </div>
            <button class="btn" data-act="loadMore">加载更多列表</button>
          </div>
          <div class="toolbarSep"></div>
          <button class="btn" data-act="archive">归档所选</button>
          <button class="btn danger" data-act="delete">删除所选</button>
          <div class="progress"></div>
        </footer>
        <div class="confirmVeil" role="dialog" aria-modal="true" aria-labelledby="fastWarnTitle">
          <div class="confirmBox"><div class="confirmIcon">!</div><h3 id="fastWarnTitle">快速加载可能触发官方限流</h3>
            <p>快速模式会明显缩短对话详情请求间隔。ChatGPT 的网页内部接口没有公开固定限额，短时间请求过多可能返回 429。扩展仍会保留最低间隔和 429 熔断保护。</p>
            <div class="confirmActions"><button class="btn" data-act="cancelFast" type="button">取消</button><button class="btn warn" data-act="confirmFast" type="button">仍然选择快速</button></div>
          </div>
        </div>
        <div class="toast"></div>
      </section>
      <div class="imageViewer" role="dialog" aria-modal="true" aria-label="图片预览" aria-hidden="true">
        <div class="imageViewerFrame">
          <div class="imageViewerLoader" aria-hidden="true"></div>
          <img class="imageViewerImage" alt="对话图片预览">
        </div>
        <div class="imageViewerHint">点击图片外任意位置关闭 · Esc</div>
      </div>
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
  const loadCountBtn = $('[data-act="loadCount"]');
  const loadCountLabel = $('.loadCountLabel');
  const loadCombo = $('.loadCombo');
  const countToggle = $('[data-act="toggleCountMenu"]');
  const countMenu = $('.countMenu');
  const speedEntry = $('.speedEntry');
  const speedCurrent = $('.speedCurrent');
  const loadSpeedMeta = $('.loadSpeedMeta');
  const confirmVeil = $('.confirmVeil');
  const listSentinel = $('.listSentinel');
  const rateBanner = $('.rateBanner');
  const rateDetail = $('.rateDetail');
  const archiveBtn = $('[data-act="archive"]');
  const deleteBtn = $('[data-act="delete"]');
  const autoExpandBtn = $('[data-act="toggleAutoExpand"]');
  const imageViewer = $('.imageViewer');
  const imageViewerImage = $('.imageViewerImage');

  function openImageViewer(url, alt = '对话图片预览') {
    if (!imageViewer || !imageViewerImage || !url) return;
    state.imageViewerOpen = true;
    imageViewer.classList.remove('loaded');
    imageViewer.classList.add('show');
    imageViewer.setAttribute('aria-hidden', 'false');
    imageViewerImage.classList.remove('loaded');
    imageViewerImage.alt = alt || '对话图片预览';
    imageViewerImage.removeAttribute('src');
    requestAnimationFrame(() => {
      imageViewerImage.src = url;
    });
  }

  function closeImageViewer() {
    if (!imageViewer || !imageViewerImage || !state.imageViewerOpen) return;
    state.imageViewerOpen = false;
    imageViewer.classList.remove('show', 'loaded');
    imageViewer.setAttribute('aria-hidden', 'true');
    imageViewerImage.classList.remove('loaded');
    imageViewerImage.removeAttribute('src');
  }

  imageViewerImage?.addEventListener('load', () => {
    if (!state.imageViewerOpen) return;
    imageViewer?.classList.add('loaded');
    imageViewerImage.classList.add('loaded');
  });
  imageViewerImage?.addEventListener('error', () => {
    if (!state.imageViewerOpen) return;
    imageViewer?.classList.add('loaded');
    showToast('图片预览加载失败');
  });

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function updateAutoExpandUI() {
    if (!autoExpandBtn) return;
    autoExpandBtn.classList.toggle('active', state.autoExpand);
    autoExpandBtn.setAttribute('aria-pressed', state.autoExpand ? 'true' : 'false');
    autoExpandBtn.title = state.autoExpand
      ? '自动展开已开启：悬停 0.5 秒展开，移出后收起'
      : '自动展开已关闭：点击卡片展开，点击卡片外区域收起';
  }

  function setAutoExpand(enabled) {
    state.autoExpand = !!enabled;
    localStorage.setItem('chatdeck:autoExpand', state.autoExpand ? '1' : '0');
    clearTimeout(state.hoverTimer);
    clearTimeout(state.collapseTimer);
    updateAutoExpandUI();
    showToast(state.autoExpand ? '自动展开已开启' : '已切换为点击展开');
  }

  function openConversationTab(id) {
    const a = document.createElement('a');
    a.href = `${location.origin}/c/${encodeURIComponent(id)}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    root.appendChild(a);
    a.click();
    a.remove();
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

  function intervalBase(kind) {
    if (kind === 'list') return LIST_MIN_INTERVAL_MS;
    if (kind === 'mutate') return MUTATION_MIN_INTERVAL_MS;
    if (kind === 'media') return MEDIA_MIN_INTERVAL_MS;
    return DETAIL_MIN_INTERVAL_MS;
  }

  function manualDetailInterval() {
    return LOAD_SPEEDS[state.loadSpeedChoice]?.interval || LOAD_SPEEDS.slow.interval;
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
    const base = intervalBase(kind);
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
    const base = intervalBase(kind);
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
    const base = intervalBase(kind);
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
      id, messages: parsed.messages, mediaSchema:2, createdAt: parsed.createdAt || getListCreatedAt(chat) || 0,
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
    listSentinel?.classList.add('show');
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
      listSentinel?.classList.remove('show');
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
    if (typeof part?.text === 'string') return part.text;
    return '';
  }

  function imageDescriptorFromPart(part) {
    if (!part || typeof part !== 'object') return null;
    const type = String(part.content_type || part.type || '');
    const assetPointer = String(part.asset_pointer || part.assetPointer || '');
    let url = '';
    if (typeof part.image_url === 'string') url = part.image_url;
    else if (typeof part.image_url?.url === 'string') url = part.image_url.url;
    else if (typeof part.url === 'string') url = part.url;
    if (!assetPointer && !url && !/image/i.test(type)) return null;
    const fileMatch = assetPointer.match(/^file-service:\/\/(.+)$/i);
    const sedimentMatch = assetPointer.match(/^sediment:\/\/(.+)$/i);
    return {
      assetPointer,
      fileId: fileMatch ? fileMatch[1] : '',
      sedimentId: sedimentMatch ? sedimentMatch[1] : '',
      url: /^(https?:|data:|blob:)/i.test(url) ? url : '',
      width: Number(part.width || part.image_width || 0) || 0,
      height: Number(part.height || part.image_height || 0) || 0,
      alt: String(part.alt || part.name || '对话图片'),
    };
  }

  function imageDescriptorFromAttachment(att) {
    if (!att || typeof att !== 'object') return null;
    const name = String(att.name || att.file_name || att.filename || '');
    const mime = String(att.mime_type || att.mimeType || att.content_type || '');
    const isImage = /^image\//i.test(mime) || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(name);
    if (!isImage) return null;
    const id = String(att.id || att.file_id || att.fileId || '');
    const raw = String(att.asset_pointer || att.assetPointer || '');
    const fileMatch = raw.match(/^file-service:\/\/(.+)$/i);
    return {
      assetPointer: raw || (id ? `file-service://${id}` : ''),
      fileId: fileMatch ? fileMatch[1] : id,
      sedimentId: '',
      url: /^(https?:|data:|blob:)/i.test(String(att.url || '')) ? String(att.url) : '',
      width: Number(att.width || 0) || 0,
      height: Number(att.height || 0) || 0,
      alt: name || '图片附件',
    };
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
      const rawRole = m?.author?.role;
      if (!m || !['user', 'assistant', 'tool'].includes(rawRole)) continue;
      const parts = Array.isArray(m?.content?.parts) ? m.content.parts : [];
      const text = parts.map(textFromPart).filter(Boolean).join('\n').trim();
      const images = [];
      for (const part of parts) {
        const img = imageDescriptorFromPart(part);
        if (img) images.push(img);
      }
      const attachments = Array.isArray(m?.metadata?.attachments) ? m.metadata.attachments : [];
      for (const att of attachments) {
        const img = imageDescriptorFromAttachment(att);
        if (img) images.push(img);
      }
      const dedup = [];
      const seen = new Set();
      for (const img of images) {
        const key = img.fileId || img.assetPointer || img.url;
        if (!key || seen.has(key)) continue;
        seen.add(key); dedup.push(img);
      }
      if (!text && !dedup.length) continue;
      // Generated images can be emitted as tool messages. Present image-bearing tool nodes as ChatGPT output.
      if (rawRole === 'tool' && !dedup.length) continue;
      const role = rawRole === 'tool' ? 'assistant' : rawRole;
      messages.push({ role, text, images:dedup, time: normalizeTimestamp(m.create_time ?? m.createTime), seq: seq++ });
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

  function imageKey(img) {
    return String(img?.fileId || img?.sedimentId || img?.assetPointer || img?.url || '');
  }

  async function resolveImageUrl(img, conversationId) {
    if (!img) return '';
    if (img.url && /^(https?:|data:|blob:)/i.test(img.url)) return img.url;
    const key = imageKey(img);
    if (!key) return '';
    if (state.imageUrlCache.has(key)) return state.imageUrlCache.get(key);
    if (state.imagePromises.has(key)) return state.imagePromises.get(key);

    const promise = (async () => {
      const paths = [];
      if (img.fileId) {
        paths.push(`/backend-api/files/download/${encodeURIComponent(img.fileId)}?conversation_id=${encodeURIComponent(conversationId)}&inline=true`);
        paths.push(`/backend-api/files/${encodeURIComponent(img.fileId)}/download`);
      }
      if (img.sedimentId) {
        paths.push(`/backend-api/conversation/${encodeURIComponent(conversationId)}/attachment/${encodeURIComponent(img.sedimentId)}/download`);
      }
      for (const path of paths) {
        try {
          const res = await apiWith429Retry(path, {}, 0, 'media');
          if (res.status === 429) return '';
          if (!res.ok) continue;
          const data = await res.json().catch(() => ({}));
          const url = String(data?.download_url || data?.url || '');
          if (/^https?:/i.test(url)) {
            state.imageUrlCache.set(key, url);
            return url;
          }
        } catch (_) {}
      }
      return '';
    })().finally(() => state.imagePromises.delete(key));
    state.imagePromises.set(key, promise);
    return promise;
  }

  async function hydrateMediaForCard(conversationId, limit = 8) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(conversationId)}"]`);
    const msgs = state.details.get(conversationId);
    if (!card || !msgs) return;
    const tiles = [...card.querySelectorAll('.mediaTile[data-msg-index][data-image-index]')].slice(0, limit);
    let firstUrl = '';
    for (const tile of tiles) {
      if (!card.isConnected) break;
      const mi = Number(tile.dataset.msgIndex);
      const ii = Number(tile.dataset.imageIndex);
      const img = msgs?.[mi]?.images?.[ii];
      if (!img) { tile.classList.add('failed'); continue; }
      const url = await resolveImageUrl(img, conversationId);
      if (!url) { tile.classList.add('failed'); continue; }
      firstUrl ||= url;
      const image = tile.querySelector('img');
      if (image) {
        image.addEventListener('load', () => tile.classList.add('loaded'), { once:true });
        image.addEventListener('error', () => tile.classList.add('failed'), { once:true });
        image.src = url;
      }
      tile.dataset.url = url;
      tile.title = '点击查看原图';
    }
    if (!firstUrl) {
      outer: for (const m of msgs) for (const img of (m.images || [])) {
        firstUrl = await resolveImageUrl(img, conversationId);
        if (firstUrl) break outer;
      }
    }
    if (firstUrl) {
      const compact = card.querySelector('.compactMedia');
      const image = compact?.querySelector('img');
      if (compact && image) {
        compact.classList.add('show');
        compact.dataset.url = firstUrl;
        image.addEventListener('load', () => compact.classList.add('loaded'), { once:true });
        image.src = firstUrl;
      }
    }
  }

  function updateCardLoadState(chatId) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(chatId)}"]`);
    if (!card) return;
    const count = card.querySelector('.count');
    const surface = card.querySelector('.cardSurface');
    const msgs = state.details.get(chatId);
    const isLoading = state.loadingIds.has(chatId);
    const chip = card.querySelector('.contentState');
    card.classList.toggle('unloaded', !msgs);
    card.classList.toggle('loaded', !!msgs);
    card.classList.toggle('contentLoading', !msgs && isLoading);
    const sep = card.querySelector('.metaSep');
    if (msgs) {
      if (count) { count.textContent = `${msgs.length} 条消息`; count.classList.remove('hidden'); }
      sep?.classList.remove('hidden');
      if (chip) { chip.className = 'contentState ready'; chip.innerHTML = ''; }
      return;
    }
    if (count) { count.textContent = ''; count.classList.add('hidden'); }
    sep?.classList.add('hidden');
    if (chip) {
      chip.className = `contentState ${isLoading ? 'loading' : 'pending'}`;
      chip.innerHTML = isLoading ? '<i></i><span>读取中</span>' : '';
    }
    const current = surface?.querySelector('.preview, .loadingPreview, .waitingPreview');
    if (current && isLoading && !current.classList.contains('loadingPreview')) {
      const tmp = document.createElement('div'); tmp.innerHTML = loadingPreviewHTML(); current.replaceWith(tmp.firstElementChild);
    } else if (current && !isLoading && current.classList.contains('loadingPreview')) {
      const tmp = document.createElement('div'); tmp.innerHTML = waitingPreviewHTML(chatId); current.replaceWith(tmp.firstElementChild);
    }
    if (card.classList.contains('expanded') && !msgs) setExpandedLoading(card, isLoading);
  }

  function needsMediaRefresh(msgs) {
    return Array.isArray(msgs) && msgs.some(m => !Array.isArray(m.images));
  }

  async function refreshDetailForMedia(chatId) {
    const current = state.details.get(chatId);
    if (!current || !needsMediaRefresh(current) || state.detailPromises.has(chatId)) return;
    const chat = state.chats.find(c => c.id === chatId);
    const p = (async () => {
      try {
        const res = await apiWith429Retry(`/backend-api/conversation/${encodeURIComponent(chatId)}`, {}, 0, 'detail');
        if (!res.ok) return;
        const parsed = parseConversation(await res.json());
        state.details.set(chatId, parsed.messages);
        if (parsed.createdAt) state.createdTimes.set(chatId, parsed.createdAt);
        await cachePut(chatId, parsed, chat);
        updateCardDetail(chatId);
      } catch (_) {}
      finally { state.detailPromises.delete(chatId); }
    })();
    state.detailPromises.set(chatId, p);
    await p;
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
      const manualSpacing = manualDetailInterval() - (Date.now() - state.lastManualRequestAt);
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

  async function ensureUnloadedCount(target) {
    const wantAll = target === Infinity;
    let guard = 0;
    while (guard++ < 200) {
      const candidates = filteredChats().filter(isUnloadedCandidate);
      if (!wantAll && candidates.length >= target) break;
      if (state.total && state.offset >= state.total) break;
      const before = state.offset;
      const got = await loadNextBatch(LIST_FETCH_MAX);
      if (!got || state.offset <= before) break;
    }
  }

  function setCountChoice(value) {
    const allowed = new Set(['10','30','50','100','all']);
    state.loadCountChoice = allowed.has(String(value)) ? String(value) : '10';
    loadCountLabel.textContent = state.loadCountChoice === 'all' ? '加载全部' : `加载 ${state.loadCountChoice} 个`;
    countMenu.querySelectorAll('.countOption').forEach(btn => btn.classList.toggle('active', btn.dataset.count === state.loadCountChoice));
  }

  function applySpeedChoice(value) {
    const next = LOAD_SPEEDS[value] ? value : 'slow';
    state.loadSpeedChoice = next;
    localStorage.setItem('chatdeck:loadSpeed', next);
    const profile = LOAD_SPEEDS[next];
    speedCurrent.textContent = profile.label;
    const speedDisplay = next === 'slow' ? '慢速' : next === 'normal' ? '正常' : '快速';
    loadSpeedMeta.textContent = `${speedDisplay} · 已加载自动跳过`;
    countMenu.querySelectorAll('.speedChoice').forEach(btn => btn.classList.toggle('active', btn.dataset.speed === next));
  }

  function setSpeedMenu(open) {
    state.speedMenuOpen = !!open;
    speedEntry?.classList.toggle('open', state.speedMenuOpen);
  }

  function setCountMenu(open) {
    state.countMenuOpen = !!open;
    loadCombo.classList.toggle('menuOpen', state.countMenuOpen);
    countToggle.setAttribute('aria-expanded', state.countMenuOpen ? 'true' : 'false');
    if (!state.countMenuOpen) setSpeedMenu(false);
  }

  function requestSpeedChoice(value) {
    if (!LOAD_SPEEDS[value]) return;
    if (value !== 'fast') {
      applySpeedChoice(value);
      setSpeedMenu(false);
      return;
    }
    state.pendingFastChoice = true;
    state.fastWarningOpen = true;
    confirmVeil.classList.add('show');
  }

  function closeFastWarning(confirmed = false) {
    confirmVeil.classList.remove('show');
    state.fastWarningOpen = false;
    if (confirmed) state.fastConfirmedForSession = true;
    if (confirmed && state.pendingFastChoice) applySpeedChoice('fast');
    const resumeLoad = confirmed && state.pendingFastLoad;
    state.pendingFastChoice = false;
    state.pendingFastLoad = false;
    if (confirmed) { setSpeedMenu(false); setCountMenu(false); }
    if (resumeLoad) setTimeout(() => loadCountDetails(), 0);
  }

  async function loadCountDetails() {
    if (state.loadSpeedChoice === 'fast' && !state.fastConfirmedForSession) {
      state.pendingFastLoad = true;
      state.pendingFastChoice = true;
      state.fastWarningOpen = true;
      confirmVeil.classList.add('show');
      return;
    }
    collapseExpanded(true);
    const raw = state.loadCountChoice;
    const wantAll = raw === 'all';
    const count = wantAll ? Infinity : Number(raw || 10);
    setCountMenu(false);
    loadCountBtn.disabled = true;
    try {
      // Important: N means N conversations whose content is not loaded yet, not the first N cards.
      // If the currently fetched list does not contain enough unloaded cards, fetch more list metadata first.
      await ensureUnloadedCount(count);
      const candidates = filteredChats().filter(isUnloadedCandidate);
      const chosen = wantAll ? candidates : candidates.slice(0, count);
      if (!chosen.length) {
        showToast('当前没有未加载的对话');
        return;
      }
      const ids = chosen.map(c => c.id);
      await startManualDetailLoad(ids, wantAll ? '读取剩余全部' : `读取接下来的 ${ids.length} 个`);
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
      return msgs?.some(m => String(m.text || '').toLowerCase().includes(q));
    });
  }

  function escapeAttr(s='') { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function escapeHtml(s='') {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function inlineMarkdown(text='') {
    const tokens = [];
    const stash = html => `\u0000${tokens.push(html)-1}\u0000`;
    let src = String(text);
    src = src.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, alt, url) => stash(`<img class="mdInlineImage" src="${escapeHtml(url)}" alt="${escapeHtml(alt || '图片')}" loading="lazy">`));
    src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`));
    src = src.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
    let out = escapeHtml(src);
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
             .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
             .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
             .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
             .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
    out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '');
    return out;
  }

  function markdownToHtml(markdown='') {
    const lines = String(markdown || '').replace(/\r\n?/g,'\n').split('\n');
    const html = [];
    let i = 0;
    const isTableSep = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
    const cells = line => String(line).trim().replace(/^\||\|$/g,'').split('|').map(x => x.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = line.match(/^\s*```([^\s`]*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        html.push(`<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      if (i + 1 < lines.length && line.includes('|') && isTableSep(lines[i+1])) {
        const head = cells(line); i += 2; const rows=[];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
        html.push(`<table><thead><tr>${head.map(c=>`<th>${inlineMarkdown(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
      if (heading) { const n=heading[1].length; html.push(`<h${n}>${inlineMarkdown(heading[2])}</h${n}>`); i++; continue; }
      if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      if (/^\s*>\s?/.test(line)) {
        const q=[]; while (i<lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/,''));
        html.push(`<blockquote>${q.map(inlineMarkdown).join('<br>')}</blockquote>`); continue;
      }
      const ul = line.match(/^\s*[-*+]\s+(.+)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ul || ol) {
        const ordered=!!ol, items=[];
        while (i<lines.length) {
          const m = ordered ? lines[i].match(/^\s*\d+[.)]\s+(.+)$/) : lines[i].match(/^\s*[-*+]\s+(.+)$/);
          if (!m) break; items.push(m[1]); i++;
        }
        const tag=ordered?'ol':'ul'; html.push(`<${tag}>${items.map(x=>`<li>${inlineMarkdown(x)}</li>`).join('')}</${tag}>`); continue;
      }
      const para=[line.trim()]; i++;
      while (i<lines.length && lines[i].trim()) {
        if (/^\s*```/.test(lines[i]) || /^\s*(#{1,4})\s+/.test(lines[i]) || /^\s*>/.test(lines[i]) || /^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i])) break;
        para.push(lines[i].trim()); i++;
      }
      html.push(`<p>${para.map(inlineMarkdown).join('<br>')}</p>`);
    }
    return html.join('');
  }

  function buildDigest(msgs) {
    const user = msgs.filter(m => m.role === 'user');
    const assistant = msgs.filter(m => m.role === 'assistant');
    const first = user[0]?.text || msgs[0]?.text || '';
    const lastUser = user[user.length - 1]?.text || first;
    const lastAnswer = assistant[assistant.length - 1]?.text || '';
    const chars = msgs.reduce((n, m) => n + String(m.text || '').length, 0);
    const images = msgs.reduce((n, m) => n + (m.images?.length || 0), 0);
    return {
      first: cleanText(first, 220),
      recent: cleanText(lastUser, 220),
      answer: cleanText(lastAnswer, 260),
      stats: `${user.length} 次提问 · ${assistant.length} 次回复${images ? ` · ${images} 张图片` : ''} · ${chars.toLocaleString('zh-CN')} 字`,
    };
  }

  function waitingPreviewHTML(id) {
    return `<div class="waitingPreview" aria-label="正文尚未读取">
      <span class="placeholderLine p1"></span>
      <span class="placeholderLine p2"></span>
      <span class="placeholderLine p3"></span>
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

  function cardLoadStatus(id) {
    if (state.details.has(id)) return { cls:'ready', label:'已加载' };
    if (state.loadingIds.has(id) || state.detailPromises.has(id) || state.manualPendingIds.has(id)) return { cls:'loading', label:'读取中' };
    return { cls:'pending', label:'未加载' };
  }

  function isUnloadedCandidate(chat) {
    if (!chat?.id || state.details.has(chat.id)) return false;
    if (state.loadingIds.has(chat.id) || state.detailPromises.has(chat.id) || state.manualPendingIds.has(chat.id)) return false;
    if (state.queue.some(item => item.id === chat.id)) return false;
    return true;
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
      const loadState = cardLoadStatus(c.id);
      const count = msgs ? `${msgs.length} 条消息` : '';
      const metaHidden = msgs ? '' : 'hidden';
      const chipHtml = loadState.cls === 'loading' ? '<i></i><span>读取中</span>' : '';
      return `<article class="card ${selected ? 'selected' : ''} ${msgs ? 'loaded' : 'unloaded'} ${loadState.cls === 'loading' ? 'contentLoading' : ''}" data-id="${escapeAttr(c.id)}">
        <div class="cardSurface">
          <div class="cardHead">
            <label class="checkWrap" title="选择对话"><input class="check" type="checkbox" ${selected ? 'checked' : ''} aria-label="选择对话" /><span class="checkBox"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2 6.5 11.3 12.9 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></label>
            <div class="titleWrap">
              <div class="title" title="双击打开原对话">${escapeAttr(c.title || '无标题对话')}</div>
              <div class="meta"><span class="createdAt" title="${escapeAttr(formatDateMs(createdAt, true))}">创建 ${escapeAttr(formatDateMs(createdAt))}</span><span class="metaSep ${metaHidden}">·</span><span class="count ${metaHidden}">${count}</span><span class="contentState ${loadState.cls}">${chipHtml}</span></div>
            </div>
            <div class="cardActions">
              <button class="mini jump" data-act="openConversation" title="在新标签页打开原对话" aria-label="在新标签页打开原对话"><svg viewBox="0 0 20 20"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M11 4h5v5M16 4l-7 7"/></svg></button>
              <button class="mini trash" data-act="singleDelete" title="删除" aria-label="删除对话"><svg viewBox="0 0 20 20"><path d="M4 6h12M8 3.5h4M6.3 6l.55 10h6.3l.55-10M8.4 8.5v5M11.6 8.5v5"/></svg></button>
            </div>
          </div>
          ${msgs ? previewHTML(msgs) : (state.loadingIds.has(c.id) ? loadingPreviewHTML() : waitingPreviewHTML(c.id))}
          <div class="compactMedia"><img alt="对话图片缩略图"></div>
          <div class="expandedBody"><div class="digest"></div><div class="messages"></div></div>
          <div class="fade"></div>
        </div>
      </article>`;
    }).join('');
    updateStats();
  }

  function clearExpandedDetail(card) {
    if (!card) return;
    const digest = card.querySelector('.digest');
    const messages = card.querySelector('.messages');
    if (digest) digest.textContent = '';
    if (messages) messages.textContent = '';
    card.dataset.expandedRendered = '';
  }

  function renderExpandedDetail(card, id) {
    if (!card?.isConnected || card.dataset.expandedRendered === '1') return;
    const msgs = state.details.get(id);
    if (!msgs) return;
    card.dataset.expandedRendered = '1';

    const d = buildDigest(msgs);
    const digest = card.querySelector('.digest');
    if (digest) {
      digest.innerHTML = `<div class="digestHead"><b>对话速览</b><span>${escapeAttr(d.stats)}</span></div>
        <div class="digestRow"><b>开始</b><span title="${escapeAttr(d.first)}">${escapeAttr(d.first || '—')}</span></div>
        <div class="digestRow"><b>最近</b><span title="${escapeAttr(d.recent)}">${escapeAttr(d.recent || '—')}</span></div>
        ${d.answer ? `<div class="digestRow"><b>末次回复</b><span title="${escapeAttr(d.answer)}">${escapeAttr(d.answer)}</span></div>` : ''}`;
    }

    const messages = card.querySelector('.messages');
    if (!messages) return;
    messages.textContent = '';
    const frag = document.createDocumentFragment();
    const max = 80;
    msgs.slice(0, max).forEach((m, msgIndex) => {
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
      const text = String(m.text || '');
      body.className = `msgBody md ${text.length > 520 ? 'long' : ''}`;
      body.innerHTML = text ? markdownToHtml(text) : '<p style="opacity:.45">图片消息</p>';
      div.append(role, body);

      if (m.images?.length) {
        const media = document.createElement('div');
        media.className = 'mediaGrid';
        m.images.forEach((img, imageIndex) => {
          const tile = document.createElement('div');
          tile.className = 'mediaTile';
          tile.dataset.msgIndex = String(msgIndex);
          tile.dataset.imageIndex = String(imageIndex);
          tile.innerHTML = `<span class="imageSkeleton"></span><img alt="${escapeAttr(img.alt || '对话图片')}" loading="lazy">`;
          media.appendChild(tile);
        });
        div.appendChild(media);
      }

      if (text.length > 520) {
        const toggle = document.createElement('button');
        toggle.className = 'msgToggle';
        toggle.dataset.act = 'toggleMsg';
        toggle.textContent = '展开这条消息';
        div.appendChild(toggle);
      }
      frag.appendChild(div);
    });
    if (msgs.length > max) {
      const hint = document.createElement('div');
      hint.className = 'moreHint';
      hint.textContent = `已显示前 ${max} 条消息 · 可用右上角跳转按钮打开完整对话`;
      frag.appendChild(hint);
    }
    messages.appendChild(frag);
  }

  function updateCardDetail(id) {
    const card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const msgs = state.details.get(id);
    if (!msgs) return;
    const chat = state.chats.find(c => c.id === id);
    const surface = card.querySelector('.cardSurface');
    const oldPreview = surface?.querySelector('.preview, .loadingPreview, .waitingPreview');
    if (oldPreview) {
      const temp = document.createElement('div');
      temp.innerHTML = previewHTML(msgs);
      oldPreview.replaceWith(temp.firstElementChild);
    }

    card.classList.remove('unloaded', 'contentLoading');
    card.classList.add('loaded');
    const count = card.querySelector('.count');
    if (count) { count.textContent = `${msgs.length} 条消息`; count.classList.remove('hidden'); }
    card.querySelector('.metaSep')?.classList.remove('hidden');
    const chip = card.querySelector('.contentState');
    if (chip) { chip.className = 'contentState ready'; chip.innerHTML = ''; }
    const timeEl = card.querySelector('.createdAt');
    if (timeEl) {
      const ms = getCreatedAt(chat);
      timeEl.textContent = `创建 ${formatDateMs(ms)}`;
      timeEl.title = formatDateMs(ms, true);
    }

    // Keep collapsed cards lightweight. The full markdown/message DOM is created only for the
    // single card the user actually expands, then discarded again after collapse.
    if (card.classList.contains('expanded') && !card.classList.contains('animating')) {
      clearExpandedDetail(card);
      renderExpandedDetail(card, id);
      hydrateMediaForCard(id).catch(() => {});
    }
  }

  let observer = null;
  function observeCards() {
    observer?.disconnect();
    if (!AUTO_BACKGROUND_PREFETCH) { observer = null; return; }
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
    loadCountBtn.disabled = state.working || state.manualLoading || state.loadingList || rateCooling;
    countToggle.disabled = state.working || state.manualLoading || state.loadingList || rateCooling;
    loadCombo.classList.toggle('busy', state.manualLoading);
    // Conversation list pagination is intentionally independent from the detail queue.
    // Users can keep scrolling and fetching more cards while a long detail batch is running.
    loadMoreBtn.disabled = state.loadingList || rateCooling || (state.total > 0 && state.offset >= state.total);
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

  function targetRectForCard(startRect) {
    const contentRect = content.getBoundingClientRect();
    const gap = 12;
    const targetWidth = Math.min(contentRect.width - 28, startRect.width * 3 + gap * 2);
    const targetHeight = Math.min(contentRect.height - 24, startRect.height * 3 + gap * 2);
    let left = startRect.left - (targetWidth - startRect.width) / 2;
    let top = startRect.top - (targetHeight - startRect.height) / 2;
    left = Math.max(contentRect.left + 10, Math.min(left, contentRect.right - targetWidth - 10));
    top = Math.max(contentRect.top + 10, Math.min(top, contentRect.bottom - targetHeight - 10));
    return { left, top, width:targetWidth, height:targetHeight };
  }

  function cancelMorphAnimation() {
    const anim = state.morphAnimation;
    state.morphAnimation = null;
    if (!anim) return;
    try { anim.cancel(); } catch (_) {}
  }

  // Freeze the exact visible pixels before reversing an opening animation midway.
  // Because getBoundingClientRect() includes the current transform, this avoids jumps on fast mouse-leave.
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
      surface.style.removeProperty('opacity');
    }
  }

  function settleOpenAnimation(surface, anim) {
    // Keep the final scale(1) visually stable while releasing WAAPI's fill layer.
    // Writing the final transform before cancel prevents the old one-frame compressed-text flash.
    surface.style.transform = 'translate3d(0,0,0) scale(1,1)';
    void surface.offsetWidth;
    try { anim.cancel(); } catch (_) {}
    surface.style.transform = 'none';
  }

  function expandCard(card) {
    if (!card?.isConnected) return;
    clearTimeout(state.collapseTimer);
    const id = card.dataset.id;
    if (state.expandedId === id && card.classList.contains('expanded') && !card.classList.contains('collapsing')) return;
    if (state.expandedId && state.expandedId !== id) collapseExpanded(true);

    const surface = card.querySelector('.cardSurface');
    if (!surface) return;

    // v0.9 behavior restored: measure the untouched hovered card first, then promote THAT SAME
    // DOM surface to its final fixed rect and invert it back over the original pixels.
    const startRect = surface.getBoundingClientRect();
    const targetRect = targetRectForCard(startRect);

    cancelMorphAnimation();
    card.classList.remove('collapsing');
    card.classList.add('morphing', 'expanded', 'animating');
    panel.classList.add('hasExpanded');
    state.expandedId = id;

    // No geometry transition is allowed here. The first painted frame is target geometry + inverse
    // transform, which is pixel-identical to startRect and therefore cannot fly in from top-left.
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
      card.classList.remove('morphing', 'animating');
      if (state.details.has(id)) renderExpandedDetail(card, id);
    } else {
      const anim = surface.animate(
        [
          { transform: inverted },
          { transform: 'translate3d(0,0,0) scale(1,1)' }
        ],
        {
          duration: 340,
          easing: 'cubic-bezier(.16,1,.3,1)',
          fill: 'both'
        }
      );
      state.morphAnimation = anim;
      anim.finished.then(() => {
        if (state.morphAnimation !== anim) return;
        state.morphAnimation = null;
        settleOpenAnimation(surface, anim);
        if (card.isConnected && state.expandedId === id && !card.classList.contains('collapsing')) {
          card.classList.remove('morphing', 'animating');
          if (state.details.has(id)) {
            renderExpandedDetail(card, id);
            hydrateMediaForCard(id).catch(() => {});
          }
        }
      }).catch(() => {});
    }

    if (!state.details.has(id)) {
      setExpandedLoading(card, state.loadingIds.has(id));
    } else if (needsMediaRefresh(state.details.get(id))) {
      // Refresh image metadata after the morph settles so network/DOM work cannot steal frames.
      setTimeout(() => {
        if (state.expandedId === id) refreshDetailForMedia(id).then(() => {
          const live = grid.querySelector(`.card[data-id=\"${CSS.escape(id)}\"]`);
          if (live) { clearExpandedDetail(live); renderExpandedDetail(live, id); }
          return hydrateMediaForCard(id);
        }).catch(() => {});
      }, 380);
    }
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
      clearExpandedDetail(card);
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

      // The grid card remains a 170px placeholder, so this is always its real home rectangle.
      const homeRect = card.getBoundingClientRect();
      // If opening is still running, freeze exactly where it currently is and reverse from there.
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
          duration: 250,
          easing: 'cubic-bezier(.22,.61,.36,1)',
          fill: 'both'
        }
      );
      state.morphAnimation = anim;
      anim.finished.then(() => {
        if (state.morphAnimation !== anim) return;
        state.morphAnimation = null;

        // Freeze the end-state transform before canceling WAAPI. The fixed surface is now exactly
        // over its grid placeholder; restoring normal card geometry in the same JS turn removes
        // the scale without exposing an intermediate tiny-text frame.
        try { anim.commitStyles?.(); } catch (_) {}
        try { anim.cancel(); } catch (_) {}
        surface.style.transition = 'none';
        card.classList.remove('expanded', 'morphing', 'animating', 'collapsing');
        surface.style.removeProperty('left');
        surface.style.removeProperty('top');
        surface.style.removeProperty('width');
        surface.style.removeProperty('height');
        surface.style.removeProperty('transform');
        surface.style.removeProperty('transform-origin');
        clearExpandedDetail(card);
        void surface.offsetWidth;
        surface.style.removeProperty('transition');
        cancelQueuedPriority(id);
        if (state.expandedId === id) state.expandedId = null;
        panel.classList.remove('hasExpanded');
      }).catch(() => {});

      setTimeout(() => {
        if (state.expandedId === id && card.classList.contains('collapsing')) finish();
      }, 380);
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
    if (act === 'close') { closeImageViewer(); collapseExpanded(true); state.opened = false; overlay.classList.remove('open'); return; }
    if (act === 'toggleAutoExpand') { setAutoExpand(!state.autoExpand); return; }
    if (act === 'loadMore') { loadNextBatch(); return; }
    if (act === 'toggleCountMenu') { if (!countToggle.disabled) setCountMenu(!state.countMenuOpen); return; }
    if (act === 'toggleSpeedMenu') { setSpeedMenu(!state.speedMenuOpen); return; }
    if (act === 'cancelFast') { closeFastWarning(false); return; }
    if (act === 'confirmFast') { closeFastWarning(true); return; }
    const countOption = e.target.closest('.countOption');
    if (countOption?.dataset.count) { setCountChoice(countOption.dataset.count); return; }
    const speedChoice = e.target.closest('.speedChoice');
    if (speedChoice?.dataset.speed) { requestSpeedChoice(speedChoice.dataset.speed); return; }
    if (act === 'loadCount') { loadCountDetails(); return; }
    if (act === 'selectVisible') {
      const list = filteredChats();
      const all = list.length && list.every(c => state.selected.has(c.id));
      for (const c of list) all ? state.selected.delete(c.id) : state.selected.add(c.id);
      render(); observeCards(); return;
    }
    if (act === 'archive') { batchAction('archive', [...state.selected]); return; }
    if (act === 'delete') { batchAction('delete', [...state.selected]); return; }
    const mediaPreview = e.target.closest('.mediaTile[data-url], .compactMedia[data-url]');
    if (mediaPreview?.dataset.url) {
      const img = mediaPreview.querySelector('img');
      openImageViewer(mediaPreview.dataset.url, img?.alt || '对话图片预览');
      return;
    }
    if (e.target.closest('.imageViewer') && !e.target.closest('.imageViewerImage')) {
      closeImageViewer();
      return;
    }
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
    if (act === 'openConversation') {
      clearTimeout(state.hoverTimer);
      openConversationTab(id);
      return;
    }
    if (act === 'singleDelete') { batchAction('delete', [id]); return; }

    // Manual mode: only a click on the non-interactive card surface expands it.
    // Buttons, checkbox controls and links retain their own behavior.
    if (!state.autoExpand && !card.classList.contains('expanded') && !e.target.closest('button, input, label, a, .mediaTile, .compactMedia, .imageViewer')) {
      expandCard(card);
      return;
    }
  });

  root.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.title');
    const card = e.target.closest('.card');
    if (title && card?.dataset.id) openConversationTab(card.dataset.id);
  });

  root.addEventListener('pointerover', (e) => {
    if (!state.autoExpand) return;
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    clearTimeout(state.collapseTimer);
    clearTimeout(state.hoverTimer);
    state.hoverTimer = setTimeout(() => expandCard(card), HOVER_EXPAND_DELAY_MS);
  });

  root.addEventListener('pointerout', (e) => {
    if (state.imageViewerOpen) return;
    if (!state.autoExpand) return;
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    clearTimeout(state.hoverTimer);
    if (state.expandedId === card.dataset.id) collapseExpanded(false);
  });

  updateAutoExpandUI();
  setCountChoice(state.loadCountChoice);
  applySpeedChoice(LOAD_SPEEDS[state.loadSpeedChoice] ? state.loadSpeedChoice : 'slow');

  root.addEventListener('pointerdown', (e) => {
    if (state.countMenuOpen && !e.target.closest('.loadCombo')) setCountMenu(false);
    // The lightbox owns outside clicks while it is open. Do not let the underlying
    // manual-expand handler interpret the same pointerdown as a request to collapse the card.
    if (state.imageViewerOpen || e.target.closest('.imageViewer')) return;
    if (!state.autoExpand && state.expandedId) {
      const expandedCard = root.querySelector(`.card[data-id="${CSS.escape(state.expandedId)}"]`);
      const clickedCard = e.target.closest('.card');
      // A click on another card is handled by the click-to-expand path, which performs a clean
      // one-step switch. Any other click outside the expanded card collapses it.
      if (expandedCard && !expandedCard.contains(e.target) && !clickedCard) collapseExpanded(false);
    }
  });

  let searchRenderTimer = null;
  search.addEventListener('input', () => {
    state.query = search.value;
    clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => { render(); observeCards(); }, 120);
  });

  let scrollLoadTimer = null;
  content.addEventListener('scroll', () => {
    if (state.expandedId && state.autoExpand) collapseExpanded(true);
    clearTimeout(scrollLoadTimer);
    // Detail loading and list pagination are separate lanes. A long “加载 N 个” job must not freeze infinite scrolling.
    if (state.loadingList || !state.total || state.offset >= state.total) return;
    if (content.scrollTop + content.clientHeight > content.scrollHeight - 680) {
      scrollLoadTimer = setTimeout(() => loadNextBatch(), 260);
    }
  }, { passive:true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.opened) pumpQueue();
  });

  updateRateBanner();
  setInterval(() => { if (Date.now() < Math.max(state.rateLimitUntil, sharedNumber('chatdeck:rateLimitUntil'))) updateRateBanner(); }, 1000);
  openCacheDb().catch(() => {});

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.imageViewerOpen) {
      closeImageViewer();
      e.preventDefault();
      return;
    }
    if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      state.opened = !state.opened;
      overlay.classList.toggle('open', state.opened);
      if (state.opened) updateRateBanner();
      if (!state.opened) collapseExpanded(true);
      if (state.opened && !state.chats.length) loadNextBatch();
    }
    if (e.key === 'Escape' && state.opened) {
      if (state.fastWarningOpen) closeFastWarning(false);
      else if (state.speedMenuOpen) setSpeedMenu(false);
      else if (state.countMenuOpen) setCountMenu(false);
      else if (state.expandedId) collapseExpanded(true);
      else { state.opened = false; overlay.classList.remove('open'); }
    }
  });
})();
