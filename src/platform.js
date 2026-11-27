// Afterglow platform layer for the phone app.
// Gives the app the same small API it has inside Claude (claude.use('db' | 'user' | 'sample' | 'downloads')),
// but backed by on-device storage and whichever model the user picks in Settings.
(() => {
  'use strict';
  const VERSION = '1.0.0';
  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tk;
  const NATIVE = !!bridge;
  const post = msg => { try { bridge.postMessage(msg); } catch (_) {} };
  const clone = v => JSON.parse(JSON.stringify(v));

  // ---------------------------------------------------------------- storage
  // In the app, every document lives as a file on the phone (the native side writes them and
  // hands them back at launch in window.TK_BOOT). In a plain browser it falls back to IndexedDB.
  const mem = new Map();
  const subs = new Set();
  let ready;
  let idb = null;

  const idbOpen = () => new Promise((res, rej) => {
    const r = indexedDB.open('afterglow', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const idbPut = (id, v) => new Promise((res, rej) => {
    const tx = idb.transaction('docs', 'readwrite');
    if (v === undefined) tx.objectStore('docs').delete(id); else tx.objectStore('docs').put(v, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });

  if (NATIVE) {
    const boot = window.TK_BOOT || {};
    for (const id of Object.keys(boot)) mem.set(id, boot[id]);
    ready = Promise.resolve();
  } else {
    ready = (async () => {
      idb = await idbOpen();
      await new Promise((res, rej) => {
        const rq = idb.transaction('docs').objectStore('docs').openCursor();
        rq.onsuccess = () => { const c = rq.result; if (c) { mem.set(c.key, c.value); c.continue(); } else res(); };
        rq.onerror = () => rej(rq.error);
      });
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
    })();
  }

  const persist = async (id, v) => {
    if (NATIVE) post(v === undefined ? { type: 'del', id } : { type: 'put', id, json: JSON.stringify(v) });
    else await idbPut(id, v);
  };
  const snapshot = () => ({ metadata: { fromCache: false }, docs: [...mem].map(([id, d]) => ({ id, data: () => d })) });
  let emitTimer = null;
  const emit = () => { clearTimeout(emitTimer); emitTimer = setTimeout(() => { const s = snapshot(); subs.forEach(f => { try { f(s); } catch (e) { console.error(e); } }); }, 0); };

  const collection = {
    doc: id => ({
      get: async () => { await ready; const d = mem.get(id); return { exists: d !== undefined, id, data: () => d }; },
      set: async d => { await ready; const v = clone(d); mem.set(id, v); await persist(id, v); emit(); },
      update: async patch => { await ready; const v = { ...(mem.get(id) || {}), ...clone(patch) }; mem.set(id, v); await persist(id, v); emit(); },
      delete: async () => { await ready; mem.delete(id); await persist(id, undefined); emit(); }
    }),
    onSnapshot: (fn, onErr) => {
      subs.add(fn);
      ready.then(() => fn(snapshot())).catch(e => onErr && onErr(e));
      return () => subs.delete(fn);
    }
  };
  const db = { collection: () => collection };

  // ---------------------------------------------------------------- settings
  const PRESETS = [
    { id: 'claude', label: 'Claude (Anthropic API key)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5',
      help: 'Get a key at console.anthropic.com. Best writing quality.' },
    { id: 'qwen', label: 'Qwen (Alibaba Cloud key)', kind: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',
      help: 'Get a key in Alibaba Cloud Model Studio. Try qwen-max for better writing.' },
    { id: 'openrouter', label: 'OpenRouter (any model)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'qwen/qwen-2.5-72b-instruct',
      help: 'One key for hundreds of models, including Qwen. Copy the exact model name from openrouter.ai.' },
    { id: 'ollama', label: 'Ollama on my computer', kind: 'openai', baseUrl: 'http://192.168.1.10:11434/v1', model: 'qwen2.5:14b', ctx: 8192, embedModel: 'nomic-embed-text',
      help: 'Replace the address with your computer’s local IP. Start Ollama with OLLAMA_HOST=0.0.0.0 so your phone can reach it. No key needed.' },
    { id: 'lmstudio', label: 'LM Studio on my computer', kind: 'openai', baseUrl: 'http://192.168.1.10:1234/v1', model: 'qwen2.5-14b-instruct', ctx: 8192, embedModel: 'text-embedding-nomic-embed-text-v1.5',
      help: 'Turn on "Serve on local network" in LM Studio and use your computer’s local IP. No key needed.' },
    { id: 'custom', label: 'Other (OpenAI-compatible)', kind: 'openai', baseUrl: 'https://', model: '',
      help: 'Any server that speaks the OpenAI chat format.' }
  ];
  // Model settings are kept as named profiles, so you can switch models quickly.
  // Stored as { profiles: [{ id, name, preset, kind, baseUrl, apiKey, model, ctx }], active: id }.
  const CFG_KEY = 'tk-model-config';
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const presetLabel = id => ((PRESETS.find(x => x.id === id) || {}).label || 'Model').replace(/\s*\(.*\)\s*$/, '');
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    if (Array.isArray(raw.profiles)) {
      const profiles = raw.profiles.filter(p => p && p.id);
      return { profiles, active: profiles.some(p => p.id === raw.active) ? raw.active : (profiles[0] && profiles[0].id) || null };
    }
    if (!raw.baseUrl) return { profiles: [], active: null };            // older single-model settings
    const one = { id: newId(), name: raw.model || presetLabel(raw.preset), preset: raw.preset, kind: raw.kind, baseUrl: raw.baseUrl, apiKey: raw.apiKey || '', model: raw.model || '' };
    if (raw.ctx !== undefined) one.ctx = raw.ctx;
    return { profiles: [one], active: one.id };
  }
  const getStore = () => { try { return normalize(JSON.parse(localStorage.getItem(CFG_KEY))); } catch (_) { return normalize(null); } };
  const saveStore = st => {
    const clean = normalize(clone(st));
    try { localStorage.setItem(CFG_KEY, JSON.stringify(clean)); } catch (_) {}
    if (NATIVE) post({ type: 'config', json: JSON.stringify(clean) }); // kept by the app so it survives web data resets
  };
  const getConfig = () => { const st = getStore(); return st.profiles.find(p => p.id === st.active) || {}; };
  const setConfig = c => {   // updates the active profile (or creates the first one)
    const st = getStore();
    const i = st.profiles.findIndex(p => p.id === st.active);
    if (i < 0) { const n = { id: newId(), name: c.name || c.model || presetLabel(c.preset), ...c }; st.profiles.push(n); st.active = n.id; }
    else st.profiles[i] = { ...st.profiles[i], ...c };
    saveStore(st);
  };
  const setActive = id => { const st = getStore(); if (st.profiles.some(p => p.id === id)) { st.active = id; saveStore(st); } };
  if (NATIVE && window.TK_CONFIG && !localStorage.getItem(CFG_KEY)) saveStore(window.TK_CONFIG);
  try { const raw = JSON.parse(localStorage.getItem(CFG_KEY)); if (raw && !Array.isArray(raw.profiles)) saveStore(raw); } catch (_) {} // turn old settings into a profile once
  // How many tokens the model can see at once. 0 means "large enough not to worry" (cloud models).
  const budget = (cfg) => {
    const c = cfg || getConfig();
    if (c.ctx !== undefined && c.ctx !== null && c.ctx !== '') return Math.max(0, +c.ctx || 0);
    const pr = PRESETS.find(x => x.id === c.preset);
    return (pr && pr.ctx) || 0;
  };
  const isConfigured = (cfg) => { const c = cfg || getConfig(); return !!(c.baseUrl && c.model && (c.apiKey || /^http:\/\//.test(c.baseUrl) || c.preset === 'ollama' || c.preset === 'lmstudio')); };

  // ---------------------------------------------------------------- network
  // In the app, requests go through the phone's own networking (no browser CORS limits, plain http
  // allowed for a computer on your Wi-Fi). In a browser they use fetch.
  const pending = new Map();
  let netSeq = 0;
  window.__tkNet = (id, kind, payload, status) => {
    const p = pending.get(id); if (!p) return;
    if (kind === 'head') p.status = status;
    else if (kind === 'chunk') { const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0)); p.onChunk(p.decoder.decode(bytes, { stream: true })); }
    else if (kind === 'done') { pending.delete(id); p.onChunk(p.decoder.decode()); p.resolve(status || p.status || 0); }
    else if (kind === 'error') { pending.delete(id); p.reject({ code: 'network', message: payload }); }
  };
  function request(url, init, onChunk, signal) {
    if (NATIVE) {
      return new Promise((resolve, reject) => {
        const id = 'n' + (++netSeq);
        pending.set(id, { resolve, reject, onChunk, decoder: new TextDecoder(), status: 0 });
        if (signal) signal.addEventListener('abort', () => { if (pending.has(id)) { pending.delete(id); post({ type: 'netCancel', id }); reject({ code: 'cancelled' }); } });
        post({ type: 'net', id, url, method: init.method || 'POST', headers: init.headers || {}, body: init.body || '' });
      });
    }
    return (async () => {
      let res;
      try { res = await fetch(url, { ...init, signal }); }
      catch (e) { throw (e && e.name === 'AbortError') ? { code: 'cancelled' } : { code: 'network', message: String(e && e.message || e) }; }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; onChunk(dec.decode(value, { stream: true })); }
      } catch (e) { throw (e && e.name === 'AbortError') ? { code: 'cancelled' } : { code: 'network', message: String(e && e.message || e) }; }
      onChunk(dec.decode());
      return res.status;
    })();
  }

  const errorFor = (status, raw) => {
    let msg = '';
    try { const j = JSON.parse(raw); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) { msg = String(raw || '').slice(0, 200); }
    msg = String(msg);
    if (status === 401 || status === 403) return { code: 'bad_key', message: msg };
    if (status === 429) return { code: 'rate_limited', message: msg };
    if (status === 404 && /model/i.test(msg)) return { code: 'bad_model', message: msg };
    if (status === 400 && /(too long|context|token)/i.test(msg)) return { code: 'prompt_too_large', message: msg };
    if (status === 404) return { code: 'bad_model', message: msg };
    return { code: 'server', message: msg || ('HTTP ' + status) };
  };

  // Some open models (Qwen 3 and others) think out loud inside <think> tags; never show that.
  const stripThink = t => String(t).replace(/<think>[\s\S]*?(<\/think>\s*|$)/g, '').replace(/^\s+/, '');

  // Turn the app's message list into a system prompt plus alternating turns.
  function shape(input) {
    const list = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
    let system = '';
    if (list.length > 1 && list[0].role === 'user') system = list.shift().content; // the story rules
    const merged = [];
    for (const m of list) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ ...m });
    }
    if (!merged.length || merged[0].role !== 'user') merged.unshift({ role: 'user', content: '(Begin.)' });
    return { system, messages: merged };
  }

  // One request at a time. A computer running a local model shares its memory between requests,
  // so a memory update and a reply at the same moment can both fail.
  let chain = Promise.resolve();
  function serial(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }
  function complete(input, opts = {}) {
    return serial(() => (opts.signal && opts.signal.aborted) ? Promise.reject({ code: 'cancelled' }) : completeNow(input, opts));
  }

  // Embeddings (for experimental memory mode): turns text into vectors so old scenes can be found by meaning.
  async function embedNow(texts, opts = {}) {
    const c = getConfig();
    if (c.kind === 'anthropic' || !opts.model) throw { code: 'no_embed' };
    const nomic = /nomic/i.test(opts.model);
    const input = texts.map((t, i) => nomic ? ((opts.query && opts.query[i]) ? 'search_query: ' : 'search_document: ') + t : t);
    const headers = { 'content-type': 'application/json' };
    if (c.apiKey) headers.authorization = 'Bearer ' + c.apiKey;
    let raw = '';
    const status = await request(c.baseUrl.replace(/\/+$/, '') + '/embeddings', { method: 'POST', headers, body: JSON.stringify({ model: opts.model, input }) }, ch => { raw += ch; });
    if (status && (status < 200 || status >= 300)) throw errorFor(status, raw);
    const j = JSON.parse(raw);
    const data = (j.data || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0)).map(d => d.embedding);
    if (data.length !== texts.length) throw { code: 'server', message: 'embedding count mismatch' };
    return data;
  }

  async function completeNow(input, opts = {}) {
    const c = opts.config || getConfig();
    if (!isConfigured(c)) throw { code: 'no_provider' };
    const { system, messages } = shape(input);
    const maxTokens = opts.maxTokens || 2048;
    let url, headers, body;
    if (c.kind === 'anthropic') {
      url = c.baseUrl.replace(/\/+$/, '') + '/v1/messages';
      headers = { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      body = { model: c.model, max_tokens: maxTokens, stream: true, messages };
      if (system) body.system = system;
    } else {
      url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      headers = { 'content-type': 'application/json' };
      if (c.apiKey) headers.authorization = 'Bearer ' + c.apiKey;
      if (c.preset === 'openrouter') { headers['HTTP-Referer'] = 'https://afterglow.app'; headers['X-Title'] = 'DreamScapes'; }
      body = { model: c.model, max_tokens: maxTokens, stream: true, messages: system ? [{ role: 'system', content: system }, ...messages] : messages };
      // Local servers can force valid JSON, which small models need for memory updates.
      if (opts.schema && (c.preset === 'lmstudio' || c.preset === 'ollama') && !opts.noSchema)
        body.response_format = { type: 'json_schema', json_schema: { name: 'memory', strict: true, schema: opts.schema } };
    }

    let raw = '', buf = '', text = '', stopReason = '', streamErr = null;
    const onChunk = chunk => { try { parse(chunk); } catch (e) { streamErr = streamErr || e; } };
    const parse = chunk => {
      raw += chunk; buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch (_) { continue; }
        let delta = '';
        if (c.kind === 'anthropic') {
          if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') delta = j.delta.text;
          if (j.type === 'message_delta' && j.delta && j.delta.stop_reason) stopReason = j.delta.stop_reason;
          if (j.type === 'error') throw { code: 'server', message: (j.error && j.error.message) || 'error' };
        } else {
          const ch = j.choices && j.choices[0];
          if (ch && ch.delta && typeof ch.delta.content === 'string') delta = ch.delta.content;
          if (ch && ch.finish_reason) stopReason = ch.finish_reason;
          if (j.error) throw { code: 'server', message: j.error.message || String(j.error) };
        }
        if (delta) { text += delta; if (opts.onText) { const shown = stripThink(text); opts.onText({ text: shown, delta }); } }
      }
    };

    let status;
    try { status = await request(url, { method: 'POST', headers, body: JSON.stringify(body) }, onChunk, opts.signal); }
    catch (e) { if (e && e.code) { e.text = stripThink(text); throw e; } throw { code: 'network', message: String(e) }; }
    if (status && (status < 200 || status >= 300)) {
      if (body.response_format && status >= 400 && status < 500 && status !== 401 && status !== 403 && !/context|token/i.test(raw)) return completeNow(input, { ...opts, noSchema: true });
      throw errorFor(status, raw);
    }
    if (streamErr) { streamErr.text = stripThink(text); throw streamErr.code ? streamErr : { code: 'server', message: String(streamErr) }; }
    if (!text) {
      // Some servers ignore stream:true and send a single JSON body.
      try {
        const j = JSON.parse(raw);
        text = c.kind === 'anthropic' ? (j.content || []).map(b => b.text || '').join('') : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      } catch (_) {}
    }
    const out = stripThink(text).trim();
    if (!out && stopReason === 'refusal') throw { code: 'refused' };
    return { text: out, truncated: stopReason === 'max_tokens' || stopReason === 'length' };
  }

  const sample = Object.assign((input, opts) => complete(input, opts), {
    json: async (input, opts = {}) => {
      const r = await complete(input, { maxTokens: 4096, ...opts });
      const t = r.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a < 0 || b <= a) throw { code: 'invalid_json' };
      try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { throw { code: 'invalid_json' }; }
    },
    limits: async () => ({ images: false }),
    budget,
    profile: () => getConfig(),
    embed: (texts, opts) => serial(() => embedNow(texts, opts))
  });

  // ---------------------------------------------------------------- files
  const all = () => { const o = {}; for (const [id, v] of mem) o[id] = v; return o; };
  async function importJSON(text) {
    const j = JSON.parse(text);
    const docs = j && (j.app === 'afterglow' || j.app === 'tale-keeper') && j.docs;
    if (!docs || typeof docs !== 'object') throw new Error('not a backup');
    await ready;
    for (const id of [...mem.keys()]) { mem.delete(id); await persist(id, undefined); }
    for (const [id, v] of Object.entries(docs)) { const val = clone(v); mem.set(id, val); await persist(id, val); }
    // Model profiles come back too (a backup without them, like one from the Claude version, keeps your current ones).
    // Backups never hold API keys, so any key already on this phone for the same profile is kept.
    if (j.models && Array.isArray(j.models.profiles) && j.models.profiles.length) {
      const keys = new Map(getStore().profiles.map(p => [p.id, p.apiKey]));
      const st = clone(j.models);
      st.profiles = st.profiles.map(p => ({ ...p, apiKey: p.apiKey || keys.get(p.id) || '' }));
      saveStore(st);
    }
    emit();
    return Object.keys(docs).length;
  }
  const downloads = {
    save: async ({ filename, data }) => {
      const text = typeof data === 'string' ? data : await new Blob([data]).text();
      if (NATIVE) { post({ type: 'share', filename, data: text }); return { status: 'saved' }; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { status: 'saved' };
    }
  };

  // ---------------------------------------------------------------- expose
  window.TK_PLATFORM = {
    version: VERSION, native: NATIVE, presets: PRESETS,
    getConfig, setConfig, isConfigured, budget, getStore, saveStore, setActive, newId,
    backupProfiles: () => { const st = getStore(); st.profiles = st.profiles.map(({ apiKey, ...p }) => p); return st; },   // no API keys in backups
    test: async (cfg) => (await complete('Reply with just the word OK.', { maxTokens: 400, config: cfg })).text.slice(0, 80) || '(empty reply)',
    importJSON, exportAll: all,
    haptic: () => { if (NATIVE) post({ type: 'haptic' }); },
    composerHeight: n => { if (NATIVE && n > 0) post({ type: 'composer', h: n }); },
    reload: () => { if (NATIVE) post({ type: 'reload' }); else location.reload(); }
  };
  const user = { id: async () => 'local', me: async () => ({ id: 'local', name: '' }), isOwner: async () => true, canEdit: async () => true };
  const caps = { db, user, sample, downloads };
  window.claude = { use: async name => caps[name] || null };
})();
