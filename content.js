(() => {
  if (window.__CGPT_CARD_MANAGER__) return;
  window.__CGPT_CARD_MANAGER__ = true;

  const BATCH_SIZE = 24;
  const PREFETCH_CONCURRENCY = 4;
  const DELETE_DELAY_MS = 180;

  const state = {
    token: null,
    chats: [],
    total: 0,
    offset: 0,
    loadingList: false,
    query: '',
    selected: new Set(),
    details: new Map(),
    detailPromises: new Map(),
    queue: [],
    activeLoads: 0,
    opened: false,
    working: false,
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

      .content { min-height:0; overflow:auto; padding: 16px; overscroll-behavior:contain; }
      .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; align-items:start; }
      .empty { grid-column:1/-1; padding:70px 20px; text-align:center; opacity:.52; }

      .card {
        position:relative; min-height:170px; max-height:170px; overflow:hidden;
        border-radius:17px; background:rgba(255,255,255,.72); border:1px solid rgba(0,0,0,.08);
        box-shadow: 0 4px 18px rgba(0,0,0,.045);
        transition: max-height .42s cubic-bezier(.22,.8,.24,1), transform .28s cubic-bezier(.22,.8,.24,1), box-shadow .28s ease, border-color .2s ease;
        will-change:max-height, transform;
      }
      @media (prefers-color-scheme: dark) { .card { background:rgba(255,255,255,.045); border-color:rgba(255,255,255,.09); box-shadow:none; } }
      .card:hover, .card.pinned { max-height:430px; transform:translateY(-3px); box-shadow:0 18px 42px rgba(0,0,0,.14); border-color:rgba(127,127,127,.24); z-index:2; }
      .card.selected { outline:2px solid currentColor; outline-offset:1px; }
      .card.deleted { opacity:.25; transform:scale(.97); pointer-events:none; }
      .cardHead { padding:14px 14px 10px; display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:start; }
      .check { width:18px; height:18px; margin:2px 0 0; accent-color:#111; cursor:pointer; }
      .titleWrap { min-width:0; }
      .title { font-size:14px; line-height:1.35; font-weight:680; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
      .meta { display:flex; gap:7px; margin-top:6px; font-size:11px; opacity:.53; }
      .mini { border:0; background:transparent; color:inherit; width:26px; height:26px; border-radius:8px; cursor:pointer; opacity:.55; }
      .mini:hover { background:rgba(127,127,127,.12); opacity:1; }

      .preview { padding:0 14px 14px 42px; font-size:12.5px; line-height:1.55; opacity:.72; height:92px; overflow:hidden; }
      .preview.loading { opacity:.42; }
      .fade { position:absolute; left:0; right:0; bottom:0; height:44px; pointer-events:none; background:linear-gradient(transparent, rgba(255,255,255,.98)); transition:opacity .18s ease; }
      @media (prefers-color-scheme: dark) { .fade { background:linear-gradient(transparent, #202022); } }
      .card:hover .fade, .card.pinned .fade { opacity:0; }

      .messages {
        margin:0 10px 10px 42px; padding:0 4px 6px 0; height:0; opacity:0; overflow:auto; overscroll-behavior:contain;
        scrollbar-width:thin; transition:height .38s cubic-bezier(.22,.8,.24,1), opacity .22s ease .08s;
      }
      .card:hover .messages, .card.pinned .messages { height:276px; opacity:1; }
      .msg { margin:0 0 9px; padding:9px 10px; border-radius:11px; font-size:12.2px; line-height:1.5; white-space:pre-wrap; word-break:break-word; background:rgba(127,127,127,.09); }
      .msg.user { background:rgba(127,127,127,.16); }
      .role { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; opacity:.45; margin-bottom:4px; }
      .moreHint { padding:10px; text-align:center; font-size:11px; opacity:.42; }

      .footer { min-height:64px; padding:11px 16px; border-top:1px solid rgba(127,127,127,.18); display:flex; align-items:center; gap:10px; }
      .stats { margin-right:auto; font-size:12px; opacity:.62; }
      .progress { font-size:12px; min-width:150px; text-align:right; opacity:.66; }
      .toolbarSep { width:1px; height:26px; background:rgba(127,127,127,.18); }
      .toast { position:absolute; left:50%; bottom:78px; transform:translateX(-50%) translateY(12px); padding:10px 13px; border-radius:12px; background:#171719; color:#fff; font-size:12px; opacity:0; pointer-events:none; transition:.22s ease; box-shadow:0 10px 34px rgba(0,0,0,.25); }
      .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
      @media (prefers-color-scheme: dark) { .toast { background:#f2f2f3; color:#151517; } }
    </style>
    <button class="launcher" title="ChatGPT 对话卡片管理器" aria-label="打开对话管理器"><span class="gridIcon"><i></i><i></i><i></i><i></i></span></button>
    <div class="overlay">
      <section class="panel">
        <header class="topbar">
          <div class="brand"><b>Chat Deck</b><span>分批读取 · 卡片预览 · 批量管理</span></div>
          <input class="search" placeholder="搜索已加载的标题或正文…" />
          <button class="btn" data-act="selectVisible">选择当前</button>
          <button class="btn close" data-act="close" title="关闭">×</button>
        </header>
        <main class="content"><div class="grid"></div></main>
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

  async function loadNextBatch() {
    if (state.loadingList || state.offset >= state.total && state.total !== 0) return;
    state.loadingList = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = '读取中…';
    try {
      const url = `/backend-api/conversations?offset=${state.offset}&limit=${BATCH_SIZE}&order=updated`;
      const res = await api(url);
      if (!res.ok) throw new Error(`列表读取失败 (${res.status})`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const known = new Set(state.chats.map(x => x.id));
      for (const item of items) if (item?.id && !known.has(item.id)) state.chats.push(item);
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

  function parseConversation(data) {
    const mapping = data?.mapping || {};
    const messages = [];
    for (const node of Object.values(mapping)) {
      const m = node?.message;
      const role = m?.author?.role;
      if (!m || !['user', 'assistant'].includes(role)) continue;
      const parts = Array.isArray(m?.content?.parts) ? m.content.parts : [];
      const text = parts.map(textFromPart).filter(Boolean).join('\n').trim();
      if (!text) continue;
      messages.push({ role, text, time: m.create_time || 0 });
    }
    messages.sort((a,b) => (a.time||0) - (b.time||0));
    return messages;
  }

  function enqueueDetail(chatId, priority = false) {
    if (state.details.has(chatId) || state.detailPromises.has(chatId)) return;
    if (state.queue.includes(chatId)) {
      if (priority) state.queue = [chatId, ...state.queue.filter(x => x !== chatId)];
      return;
    }
    priority ? state.queue.unshift(chatId) : state.queue.push(chatId);
    pumpQueue();
  }

  function pumpQueue() {
    while (state.activeLoads < PREFETCH_CONCURRENCY && state.queue.length) {
      const id = state.queue.shift();
      state.activeLoads++;
      const p = (async () => {
        try {
          const res = await api(`/backend-api/conversation/${encodeURIComponent(id)}`);
          if (!res.ok) throw new Error(`正文读取失败 (${res.status})`);
          const data = await res.json();
          state.details.set(id, parseConversation(data));
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
  }

  function formatDate(t) {
    if (!t) return '未知时间';
    const d = new Date(t * 1000);
    if (Number.isNaN(+d)) return '未知时间';
    return new Intl.DateTimeFormat('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(d);
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

  function render() {
    const list = filteredChats();
    if (!list.length) {
      grid.innerHTML = `<div class="empty">${state.chats.length ? '没有匹配的已加载对话' : '点击“加载下一批”开始读取历史对话'}</div>`;
      updateStats();
      return;
    }
    grid.innerHTML = list.map(c => {
      const selected = state.selected.has(c.id);
      const msgs = state.details.get(c.id);
      const first = msgs?.[0]?.text || '进入视口或将鼠标悬停在卡片上后加载内容预览…';
      const count = msgs ? `${msgs.length} 条消息` : '正文未加载';
      return `<article class="card ${selected ? 'selected' : ''}" data-id="${escapeAttr(c.id)}">
        <div class="cardHead">
          <input class="check" type="checkbox" ${selected ? 'checked' : ''} aria-label="选择对话" />
          <div class="titleWrap">
            <div class="title" title="双击打开原对话">${escapeAttr(c.title || '无标题对话')}</div>
            <div class="meta"><span>${formatDate(c.update_time || c.create_time)}</span><span>·</span><span class="count">${count}</span></div>
          </div>
          <button class="mini" data-act="singleDelete" title="删除">×</button>
        </div>
        <div class="preview ${msgs ? '' : 'loading'}">${escapeAttr(first.slice(0, 360))}</div>
        <div class="messages"></div>
        <div class="fade"></div>
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
    const preview = card.querySelector('.preview');
    const messages = card.querySelector('.messages');
    const count = card.querySelector('.count');
    count.textContent = `${msgs.length} 条消息`;
    preview.classList.remove('loading');
    preview.textContent = msgs[0]?.text?.slice(0, 360) || '没有可显示的文本消息';
    messages.textContent = '';
    const max = 60;
    for (const m of msgs.slice(0, max)) {
      const div = document.createElement('div');
      div.className = `msg ${m.role}`;
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = m.role === 'user' ? '你' : 'ChatGPT';
      const body = document.createElement('span');
      body.textContent = m.text;
      div.append(role, body);
      messages.appendChild(div);
    }
    if (msgs.length > max) {
      const hint = document.createElement('div');
      hint.className = 'moreHint';
      hint.textContent = `仅显示前 ${max} 条文本消息 · 双击标题打开完整对话`;
      messages.appendChild(hint);
    }
  }

  let observer = null;
  function observeCards() {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) enqueueDetail(e.target.dataset.id, false);
    }, { root: content, rootMargin:'220px', threshold:.01 });
    grid.querySelectorAll('.card').forEach(card => observer.observe(card));
  }

  function updateStats() {
    const visible = filteredChats().length;
    stats.textContent = `已读取 ${state.chats.length}${state.total ? ` / ${state.total}` : ''} · 当前 ${visible} · 已选 ${state.selected.size}`;
    archiveBtn.disabled = deleteBtn.disabled = state.selected.size === 0 || state.working;
  }

  async function patchConversation(id, body) {
    const res = await api(`/backend-api/conversation/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) });
    if (!res.ok) throw new Error(`操作失败 (${res.status})`);
  }

  async function batchAction(mode, ids) {
    if (!ids.length || state.working) return;
    const label = mode === 'delete' ? '删除' : '归档';
    if (mode === 'delete' && !confirm(`确定永久删除选中的 ${ids.length} 个对话吗？\n\n此操作无法在本扩展中撤销。`)) return;
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
    if (act === 'close') { state.opened = false; overlay.classList.remove('open'); return; }
    if (act === 'loadMore') { loadNextBatch(); return; }
    if (act === 'selectVisible') {
      const list = filteredChats();
      const all = list.length && list.every(c => state.selected.has(c.id));
      for (const c of list) all ? state.selected.delete(c.id) : state.selected.add(c.id);
      render(); observeCards(); return;
    }
    if (act === 'archive') { batchAction('archive', [...state.selected]); return; }
    if (act === 'delete') { batchAction('delete', [...state.selected]); return; }

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

  root.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.card');
    if (card) enqueueDetail(card.dataset.id, true);
  });

  search.addEventListener('input', () => {
    state.query = search.value;
    render(); observeCards();
  });

  content.addEventListener('scroll', () => {
    if (state.loadingList || !state.total || state.offset >= state.total) return;
    if (content.scrollTop + content.clientHeight > content.scrollHeight - 700) loadNextBatch();
  }, { passive:true });

  document.addEventListener('keydown', (e) => {
    if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      state.opened = !state.opened;
      overlay.classList.toggle('open', state.opened);
      if (state.opened && !state.chats.length) loadNextBatch();
    }
    if (e.key === 'Escape' && state.opened) {
      state.opened = false; overlay.classList.remove('open');
    }
  });
})();
