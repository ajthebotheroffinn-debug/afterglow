/* ---------- presets ---------- */
async function seedPreset(key, open) {
  const p = PRESETS[key]; if (!p || state.seeding) return;
  state.seeding = true;
  const { id: cid, ...c } = p.char; const { id: sid, ...st } = p.story;
  if (!get(cid)) await create(cid, { kind: 'char', ...c, updatedAt: Date.now() });
  if (!get(sid)) await create(sid, { kind: 'story', ...st, userName: '', chars: [cid], createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ id: rid(), role: 'ai', text: c.greeting, ts: Date.now() }], memory: mem({}), sinceMemory: MEMORY_EVERY });
  await (get('meta_presets') ? save('meta_presets', { [key]: true }) : create('meta_presets', { kind: 'meta', [key]: true }));
  state.seeding = false;
  if (open) { state.view = { name: 'story', id: sid }; }
  render();
}

let downloads = null;
// Reads a profile written out as text, e.g. one Claude gives you:
//   Profile name: Rocinante 12B / Provider: LM Studio / Server address: https://... / Model name: ... / Context size: 32768
// One "Label: value" per line (JSON works too). Unknown lines are ignored.
function parseProfileText(text, presets) {
  const out = {};
  let obj = null;
  try { const j = JSON.parse(text); if (j && typeof j === 'object') obj = j; } catch (_) {}
  const pairs = obj ? Object.entries(obj).map(([k, v]) => [k, String(v)])
    : String(text || '').split(/\r?\n/).map(l => l.replace(/^[\s*\-•>]+/, '').replace(/\*\*/g, '')).map(l => { const i = l.indexOf(':'); return i > 0 ? [l.slice(0, i), l.slice(i + 1)] : null; }).filter(Boolean);
  const yes = v => /^(on|yes|true|enabled?|1)\b/i.test(v.trim());
  for (let [k, v] of pairs) {
    k = k.toLowerCase().replace(/[^a-z]/g, ''); v = v.trim().replace(/^[`"']+|[`"']+$/g, '');
    if (!v && !/key/.test(k)) continue;
    if (['name', 'profilename', 'profile'].includes(k)) out.name = v;
    else if (['provider', 'preset', 'type', 'service'].includes(k)) {
      const t = v.toLowerCase();
      const pr = presets.find(x => x.id === t) || presets.find(x => t.includes(x.id)) ||
        (/lm ?studio/.test(t) && presets.find(x => x.id === 'lmstudio')) || (/anthropic/.test(t) && presets.find(x => x.id === 'claude')) ||
        (/other|openai|custom/.test(t) && presets.find(x => x.id === 'custom')) || presets.find(x => x.label.toLowerCase().startsWith(t));
      if (pr) out.preset = pr.id;
    }
    else if (['serveraddress', 'address', 'server', 'baseurl', 'url', 'endpoint'].includes(k)) out.baseUrl = v.replace(/\/+$/, '');
    else if (['apikey', 'key'].includes(k)) out.apiKey = /^(none|n\/a|-)$/i.test(v) ? '' : v;
    else if (['model', 'modelname', 'modelid'].includes(k)) out.model = v;
    else if (['context', 'contextsize', 'contextsizetokens', 'contextlength', 'ctx'].includes(k)) { const n = parseInt(v.replace(/[^\d]/g, ''), 10); if (n) out.ctx = n; }
    else if (k.startsWith('experimentalmemory') || k === 'xmem') out.xmem = yes(v);
    else if (k.startsWith('consistencycheck') || k === 'xcheck') out.xcheck = yes(v);
    else if (k.startsWith('embedding') || k === 'embedmodel') out.embedModel = /^(none|off|-)$/i.test(v) ? '' : v;
  }
  return out;
}
function settingsSheet(startAt) {
  const P = window.TK_PLATFORM; if (!P) return;
  const presets = P.presets;
  const store = P.getStore();
  if (!store.profiles.length) { const pr = presets.find(x => x.id === 'lmstudio') || presets[0]; const n = { id: P.newId(), name: 'My model', preset: pr.id, kind: pr.kind, baseUrl: pr.baseUrl, apiKey: '', model: pr.model, ctx: pr.ctx || 0 }; store.profiles.push(n); store.active = n.id; }
  const presetOf = id => presets.find(x => x.id === id) || presets[0];
  const shortLabel = id => presetOf(id).label.replace(/\s*\(.*\)\s*$/, '');
  const byId = id => store.profiles.find(x => x.id === id);
  const persist = () => P.saveStore(store);

  // ---- small building blocks: iOS-style grouped rows
  const chev = () => { const s = h('span', { class: 'chev', 'aria-hidden': 'true' }); s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>'; return s; };
  const group = (title, rows, foot) => h('div', { class: 'sgroup-wrap' }, title ? h('h3', { class: 'section' }, title) : null, h('div', { class: 'sgroup' }, rows), foot ? h('p', { class: 'sectionnote sfoot' }, foot) : null);
  const navRow = (id, label, detail, fn) => h('button', { class: 'srow nav', id, type: 'button', onclick: fn }, h('span', { class: 'slabel' }, label), h('span', { class: 'sdetail' }, detail || ''), chev());
  const toggleRow = (input, label, hint) => h('label', { class: 'srow toggle' }, h('span', { class: 'pbody' }, h('span', { class: 'slabel' }, label), hint ? h('span', { class: 'shint' }, hint) : null), input, h('span', { class: 'switch', 'aria-hidden': 'true' }));

  // ---- page navigation inside the sheet
  const host = h('div', { class: 'spage' });
  const done = h('button', { class: 'primary', onclick: () => { leave(); persist(); closeSheet(); render(); } }, 'Done');
  openSheet('Settings', [host], [h('span'), done]);
  const panel = host.closest('.panel'), title = panel.querySelector('h2'), ver = panel.querySelector('.ver');
  const back = h('button', { class: 'sback', type: 'button', onclick: () => go(-1) }, chev(), 'Back');
  title.before(back);
  const stack = []; let leave = () => {};
  function show(page, dir) {
    leave(); leave = page.leave || (() => {});
    host.replaceChildren(...page.body.filter(Boolean));
    title.textContent = page.title;
    back.hidden = stack.length < 2; if (ver) ver.hidden = stack.length > 1;
    host.classList.remove('in-fwd', 'in-back'); void host.offsetWidth; host.classList.add(dir < 0 ? 'in-back' : 'in-fwd');
    panel.scrollTop = 0;
  }
  const open = make => { stack.push(make); show(make(), 1); };
  function go(d) { if (d < 0 && stack.length > 1) { stack.pop(); show(stack[stack.length - 1](), -1); } }

  // ---- main page
  const mainPage = () => {
    const act = byId(store.active) || store.profiles[0];
    return { title: 'Settings', body: [
      group('Model', [
        navRow('set-go-active', 'In use', act ? act.name || 'Model' : 'None', () => open(() => profilePage(act.id))),
        navRow('set-go-profiles', 'All profiles', String(store.profiles.length), () => open(profilesPage))
      ], act ? [shortLabel(act.preset), act.model].filter(Boolean).join(' · ') : null),
      group('Data', [navRow('set-go-backups', 'Backups', '', () => open(backupsPage))]),
      group('About', [
        h('div', { class: 'srow' }, h('span', { class: 'slabel' }, 'Version'), h('span', { class: 'sdetail' }, APP_VERSION)),
        h('button', { class: 'srow nav accent', type: 'button', onclick: () => P.reload() }, 'Check for updates')
      ], 'Updates download automatically when you open the app.')
    ] };
  };

  // ---- list of profiles
  const profilesPage = () => ({ title: 'Model profiles', body: [
    h('p', { class: 'sectionnote' }, 'Save a profile for each model you try. Switch between them here or from the story menu.'),
    group(null, store.profiles.map(p => h('button', { class: 'srow nav', type: 'button', onclick: () => open(() => profilePage(p.id)) },
      h('span', { class: 'pbody' }, h('span', { class: 'slabel' }, p.name || 'Model', p.id === store.active ? h('span', { class: 'badge' }, 'In use') : null),
        h('span', { class: 'shint' }, [shortLabel(p.preset), p.model].filter(Boolean).join(' · '))), chev()))),
    h('div', { class: 'field', style: 'margin-top:12px' }, h('button', { class: 'ghost', type: 'button', onclick: () => {
      const cur = byId(store.active) || store.profiles[0];
      const n = { ...cur, id: P.newId(), name: (cur.name || 'Model') + ' copy' };
      store.profiles.push(n); open(() => profilePage(n.id, true)); } }, '+ New profile')),
    group('Paste a profile', [h('button', { class: 'srow nav accent', id: 'set-paste-btn', type: 'button', onclick: async () => {
      let t = '';
      try { t = await navigator.clipboard.readText(); } catch (_) {}
      if (t && applyPasted(t)) return;
      pasteBox.hidden = false; pasteTa.focus(); } }, 'Paste from clipboard')],
      'Copy a profile from Claude (lines like "Model name: ...") and tap Paste. It fills in everything; check it and tap Use this profile.'),
    pasteBox
  ] });
  const pasteTa = h('textarea', { id: 'set-paste-text', rows: '6', placeholder: 'Or paste it here' });
  const pasteBox = h('div', { class: 'field', hidden: true }, pasteTa, h('button', { class: 'ghost', type: 'button', onclick: () => { if (!applyPasted(pasteTa.value)) toast('Couldn\'t find any profile settings in that.'); } }, 'Fill in profile'));
  // Fills a profile from pasted text: updates the one with the same name, or makes a new one.
  function applyPasted(text) {
    const f = parseProfileText(text, presets);
    if (!Object.keys(f).length) return false;
    let p = f.name && store.profiles.find(x => (x.name || '').toLowerCase() === f.name.toLowerCase());
    if (!p) {
      const pr = presetOf(f.preset || 'custom');
      p = { id: P.newId(), name: f.name || 'Pasted model', preset: pr.id, kind: pr.kind, baseUrl: pr.baseUrl, apiKey: '', model: pr.model, ctx: pr.ctx || 0, embedModel: pr.embedModel || '' };
      store.profiles.push(p);
    }
    if (f.preset) { const pr = presetOf(f.preset); p.preset = pr.id; p.kind = pr.kind; }
    Object.assign(p, f);
    pasteTa.value = ''; pasteBox.hidden = true;
    toast('Filled in. Check it, then tap Use this profile.');
    open(() => profilePage(p.id));
    return true;
  }

  // ---- one profile
  function profilePage(pid, fresh) {
    const p = byId(pid); if (!p) return mainPage();
    const input = (id, extra) => h('input', { id, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...extra });
    const pname = input('set-pname', { maxlength: '40', autocapitalize: 'words', placeholder: 'e.g. Rocinante 12B', value: p.name || '' });
    const base = input('set-base', { inputmode: 'url', value: p.baseUrl || '' });
    const key = input('set-key', { type: 'password', value: p.apiKey || '' });
    const model = input('set-model', { value: p.model || '' });
    const ctx = input('set-ctx', { inputmode: 'numeric', placeholder: 'Leave blank for cloud models',
      value: p.ctx ? String(p.ctx) : (p.ctx === undefined && presetOf(p.preset).ctx ? String(presetOf(p.preset).ctx) : '') });
    const xm = h('input', { type: 'checkbox', id: 'set-xmem', checked: !!p.xmem });
    const xc = h('input', { type: 'checkbox', id: 'set-xcheck', checked: !!p.xcheck });
    const emb = input('set-emb', { placeholder: 'e.g. text-embedding-nomic-embed-text-v1.5', value: p.embedModel !== undefined ? p.embedModel : (presetOf(p.preset).embedModel || '') });
    const help = h('span', { class: 'hint' }, presetOf(p.preset).help || '');
    const status = h('div', { class: 'note', 'aria-live': 'polite', hidden: true });
    const grab = () => Object.assign(p, { name: pname.value.trim() || p.name || 'My model', kind: presetOf(p.preset).kind, baseUrl: base.value.trim().replace(/\/+$/, ''),
      apiKey: key.value.trim(), model: model.value.trim(), ctx: parseInt(ctx.value, 10) || 0, xmem: xm.checked, xcheck: xc.checked, embedModel: emb.value.trim() });
    const radios = h('div', { class: 'checks' }, presets.map(pr => h('label', {}, h('input', { type: 'radio', name: 'set-preset', value: pr.id, checked: p.preset === pr.id,
      onchange: () => { p.preset = pr.id; p.kind = pr.kind; base.value = pr.baseUrl; model.value = pr.model; ctx.value = pr.ctx ? String(pr.ctx) : ''; emb.value = pr.embedModel || ''; help.textContent = pr.help || ''; } }), pr.label)));
    const showKey = h('button', { class: 'ghost', type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; showKey.textContent = key.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
    const xBox = h('div', { hidden: !xm.checked }, group(null, [toggleRow(xc, 'Consistency check', 'Checks each reply against the whole story before you see it and fixes contradictions. Slower.')]),
      field('Embedding model (optional)', emb, 'Finds old scenes by meaning, not just matching words. Use the exact name from LM Studio\'s /v1/models. Leave blank to match by words.'));
    xm.addEventListener('change', () => { xBox.hidden = !xm.checked; });
    const inUse = store.active === p.id;
    const useBtn = h('button', { class: 'primary', id: 'set-use', type: 'button', onclick: () => { grab(); store.active = p.id; persist(); closeSheet(); toast(`Saved. Using ${p.name}.`); render(); } }, inUse ? 'Save' : 'Use this profile');
    const del = confirmBtn('Delete profile', () => {
      if (store.profiles.length < 2) { toast('Keep at least one profile.'); return; }
      store.profiles = store.profiles.filter(x => x.id !== p.id);
      if (!store.profiles.some(x => x.id === store.active)) store.active = store.profiles[0].id;
      persist(); leave = () => {}; go(-1); });
    return { title: fresh ? 'New profile' : (p.name || 'Profile'), leave: grab, body: [
      inUse ? h('div', { class: 'note' }, 'This profile is in use.') : null,
      field('Profile name', pname),
      h('h3', { class: 'section' }, 'Connection'),
      h('div', { class: 'field' }, h('label', {}, 'Provider'), radios, help),
      field('Server address', base),
      h('div', { class: 'field' }, h('label', { for: 'set-key' }, 'API key'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1;min-width:0;display:flex' }, key), showKey), h('span', { class: 'hint' }, 'Stored only on this phone. Never put in backups.')),
      field('Model name', model),
      field('Context size (tokens)', ctx, 'For LM Studio or Ollama, the same number as the model\'s context length. Leave blank for Claude, Qwen or OpenRouter.'),
      h('div', { class: 'field' }, h('button', { class: 'ghost', type: 'button', onclick: async () => {
        grab(); status.hidden = false; status.textContent = 'Testing…';
        try { const r = await P.test({ ...p }); status.textContent = 'Connected. The model said: ' + r; }
        catch (e) { status.textContent = errorCopy(e); } } }, 'Test connection'), status),
      h('h3', { class: 'section' }, 'Memory'),
      group(null, [toggleRow(xm, 'Experimental memory mode', 'For local models: pulls back more old scenes, searches older memories, can match by meaning.')]),
      xBox,
      h('div', { class: 'row sactions' }, useBtn, del)
    ] };
  }

  // ---- backups
  const backupsPage = () => {
    const fileIn = h('input', { type: 'file', id: 'set-import-file', accept: 'application/json,.json,text/plain', hidden: true });
    const paste = h('textarea', { id: 'set-import-text', rows: '3', placeholder: 'Or paste a backup here' });
    const doImport = async text => {
      try { const n = await P.importJSON(text); closeSheet(); state.view = { name: 'home' }; toast(`Imported ${n} items.`); }
      catch (e) { toast('That file is not a DreamScapes backup.'); } };
    fileIn.addEventListener('change', async () => { const f = fileIn.files && fileIn.files[0]; if (f) doImport(await f.text()); });
    return { title: 'Backups', body: [
      h('p', { class: 'sectionnote' }, P.native ? 'Everything is saved on this phone and backed up automatically every day to Files › On My iPhone › DreamScapes.' : 'Everything is saved in this browser.'),
      group('Save', [h('button', { class: 'srow nav accent', type: 'button', onclick: () => exportAll() }, 'Export backup')],
        'Includes your stories, characters, personas and model profiles. API keys are never included.'),
      group('Restore', [h('button', { class: 'srow nav accent', type: 'button', onclick: () => fileIn.click() }, 'Import backup file')],
        'Importing replaces everything in the app with the backup. Re-enter API keys afterwards if you\'re on a new phone.'),
      fileIn,
      h('div', { class: 'field' }, paste, h('button', { class: 'ghost', type: 'button', onclick: () => { if (paste.value.trim()) doImport(paste.value.trim()); } }, 'Import pasted backup'))
    ] };
  };

  open(mainPage);
  if (startAt === 'profiles') open(profilesPage);
}
function modelMenu() {
  const P = window.TK_PLATFORM; if (!P) return;
  const st = P.getStore();
  const item = p => h('button', { role: 'menuitem', onclick: () => { P.setActive(p.id); closeSheet(); toast(`Using ${p.name}.`); render(); } },
    h('span', {}, p.name || 'Model'), h('span', { class: 'hint' }, p.id === st.active ? '✓' : ''));
  openMenu(h('div', { class: 'menu', role: 'menu', 'aria-label': 'Switch model' },
    h('div', { class: 'preview' }, 'Switch model'), ...st.profiles.map(item), h('div', { class: 'gap' }),
    h('button', { role: 'menuitem', onclick: () => { closeSheet(); setTimeout(() => settingsSheet('profiles'), 220); } }, h('span', {}, 'Edit profiles…'), icon('gear'))));
}
async function exportAll() {
  const docs = {};
  for (const [id, v] of state.items) { const { id: _drop, ...rest } = v; docs[id] = rest; }
  const models = STANDALONE ? window.TK_PLATFORM.backupProfiles() : undefined;   // model profiles, without API keys
  const json = JSON.stringify({ app: 'afterglow', version: 1, exportedAt: new Date().toISOString(), docs, ...(models && models.profiles.length ? { models } : {}) });
  const name = `dreamscapes-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (downloads) {
    try { await downloads.save({ filename: name, data: json }); toast('Exported. Import this file in the app.'); return; }
    catch (e) { if (e && e.code === 'declined') return; }
  }
  try { await navigator.clipboard.writeText(json); toast('Copied your backup. Paste it into the app\'s Import box.'); }
  catch (_) {
    const ta = h('textarea', { id: 'export-text', rows: '10', readonly: true, value: json });
    openSheet('Your backup', [h('div', { class: 'field' }, ta, h('span', { class: 'hint' }, 'Select all of this, copy it, and paste it into the app\'s Import box.'))], [h('span'), h('button', { class: 'primary', onclick: closeSheet }, 'Done')]);
    setTimeout(() => { ta.focus(); ta.select(); }, 60);
  }
}
// One-time edits to the built-in Valerie characters already saved on the phone (only the exact
// original wording is changed, so anything you edited yourself is left alone).
const VAL_UPDATES = [
  ['val20', [['21, a university junior studying photography', '20, a university sophomore studying photography'],
    ['divorced during her sophomore year', 'divorced during her freshman year'],
    ['falling for {{user}} sophomore year', 'falling for {{user}} freshman year'],
    ['Started liking you sophomore year', 'Started liking you freshman year'],
    ['"Val", 21, a university student', '"Val", 20, a university sophomore']]]
];
async function updateBuiltIns() {
  for (const [flag, pairs] of VAL_UPDATES) {
    if ((get('meta_presets') || {})[flag]) continue;
    for (const cid of ['char_valerie', 'char_valerie_evo']) {
      const c = get(cid); if (!c || !c.persona) continue;
      let p = c.persona; for (const [a, b] of pairs) p = p.split(a).join(b);
      if (p !== c.persona) await save(cid, { persona: p, updatedAt: Date.now() });
    }
    await (get('meta_presets') ? save('meta_presets', { [flag]: true }) : create('meta_presets', { kind: 'meta', [flag]: true }));
  }
}
async function seedDefaults() {
  await updateBuiltIns();
  const meta = get('meta_presets') || {};
  if (!meta.valerie && !get('story_valerie')) await seedPreset('valerie', false);
  if (!get('meta_presets')?.valerieEvo && !get('char_valerie_evo') && !state.seeding) {
    state.seeding = true;
    await create('char_valerie_evo', { kind: 'char', name: 'Valerie', evolved: true, persona: VAL_EVO_CORE + '\n\n' + VAL_VOICE, greeting: VAL_OPENING, updatedAt: Date.now() });
    await (get('meta_presets') ? save('meta_presets', { valerieEvo: true }) : create('meta_presets', { kind: 'meta', valerieEvo: true }));
    state.seeding = false; render();
  }
  if (!get('meta_presets')?.aj && !personas().length && !state.seeding) {
    state.seeding = true;
    await create('persona_aj', { kind: 'persona', name: 'AJ', gender: 'Male', isDefault: true, updatedAt: Date.now(),
      description: 'According to others, he\'s jacked: 165 lb, lean, 5\'11", with a very obvious six-pack, veiny arms and hands, and large hands. It\'s all a "sleeper build", because he\'s kind of shy and a little nerdy. Asian. Dresses very well, has very nice straight white teeth, and always wears very nice-smelling cologne.' });
    await (get('meta_presets') ? save('meta_presets', { aj: true }) : create('meta_presets', { kind: 'meta', aj: true }));
    state.seeding = false; render();
  }
}

/* ---------- boot ---------- */
render();
(async () => {
  const C = window.claude;
  if (!C || !C.use) { state.phase = 'nodb'; render(); return; }
  const [d, u, s, dl] = await Promise.all([C.use('db'), C.use('user'), C.use('sample'), C.use('downloads')]);
  downloads = dl;
  sample = s;
  const uid = u ? await u.id() : null;
  if (!d || !uid) { state.phase = 'nodb'; render(); return; }
  db = d; col = db.collection('data/users/' + uid);
  const timer = setTimeout(() => { state.slow = true; if (state.phase === 'loading') render(); }, 10000);
  col.onSnapshot(snap => {
    clearTimeout(timer);
    const next = new Map();
    for (const doc of snap.docs) next.set(doc.id, { id: doc.id, ...doc.data() });
    state.items = next; state.phase = 'ready';
    if (!snap.metadata.fromCache && !state.seeding) seedDefaults();
    if (state.view.name === 'story') { if (!get(state.view.id)) render(); else { paintBar(); paintStory(); } }
    else render();
  }, () => { clearTimeout(timer); state.phase = 'nodb'; render(); });
})();
