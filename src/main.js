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
function settingsSheet() {
  const P = window.TK_PLATFORM; if (!P) return;
  const presets = P.presets;
  const store = P.getStore();
  if (!store.profiles.length) { const pr = presets.find(x => x.id === 'lmstudio') || presets[0]; const n = { id: P.newId(), name: 'My model', preset: pr.id, kind: pr.kind, baseUrl: pr.baseUrl, apiKey: '', model: pr.model, ctx: pr.ctx || 0 }; store.profiles.push(n); store.active = n.id; }
  let sel = store.active;
  const prof = () => store.profiles.find(x => x.id === sel);
  const input = (id, extra) => h('input', { id, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...extra });
  const pname = input('set-pname', { maxlength: '40', autocapitalize: 'words', placeholder: 'e.g. Stheno 8B, Nemo 12B, Claude' });
  const base = input('set-base', { inputmode: 'url' });
  const key = input('set-key', { type: 'password' });
  const model = input('set-model');
  const ctx = input('set-ctx', { inputmode: 'numeric', placeholder: 'Leave blank for cloud models' });
  const xm = h('input', { type: 'checkbox', id: 'set-xmem' });
  const emb = input('set-emb', { placeholder: 'e.g. text-embedding-nomic-embed-text-v1.5' });
  const xc = h('input', { type: 'checkbox', id: 'set-xcheck' });
  const embBox = h('div', {}, h('div', { class: 'field' }, h('div', { class: 'checks' }, h('label', {}, xc, h('span', { class: 'pbody' }, h('span', {}, 'Consistency check'),
      h('span', { class: 'hint', style: 'display:block' }, 'After each reply is written, searches the whole story and memory for anything it mentions and fixes contradictions before you see it. Replies take longer.'))))), field('Embedding model (optional)', emb, 'Lets recall find old scenes by meaning, not just matching words. In LM Studio, use the embedding model\'s exact name from /v1/models. Leave blank to match by words only.'));
  const syncX = () => { embBox.hidden = !xm.checked; };
  xm.addEventListener('change', syncX);
  const help = h('span', { class: 'hint' });
  const status = h('div', { class: 'note', 'aria-live': 'polite', hidden: true });
  const radios = h('div', { class: 'checks' });
  const plist = h('div', { class: 'checks' });
  const showKey = h('button', { class: 'ghost', type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; showKey.textContent = key.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  const presetOf = id => presets.find(x => x.id === id) || presets[0];
  // Copy what is on screen into the profile being edited.
  const grab = () => { const p = prof(); if (!p) return;
    Object.assign(p, { name: pname.value.trim() || p.name || 'My model', kind: presetOf(p.preset).kind, baseUrl: base.value.trim().replace(/\/+$/, ''), apiKey: key.value.trim(), model: model.value.trim(), ctx: parseInt(ctx.value, 10) || 0, xmem: xm.checked, xcheck: xc.checked, embedModel: emb.value.trim() }); };
  const showProvider = () => {
    radios.textContent = '';
    const p = prof();
    presets.forEach(pr => radios.append(h('label', {}, h('input', { type: 'radio', name: 'set-preset', value: pr.id, checked: p.preset === pr.id,
      onchange: () => { grab(); p.preset = pr.id; p.kind = pr.kind; p.baseUrl = pr.baseUrl; p.model = pr.model; p.ctx = pr.ctx || 0; p.embedModel = pr.embedModel || ''; load(); } }), pr.label)));
    help.textContent = presetOf(p.preset).help || '';
  };
  const load = () => { const p = prof();
    pname.value = p.name || ''; base.value = p.baseUrl || ''; key.value = p.apiKey || ''; model.value = p.model || '';
    ctx.value = p.ctx ? String(p.ctx) : (p.ctx === undefined && presetOf(p.preset).ctx ? String(presetOf(p.preset).ctx) : '');
    xm.checked = !!p.xmem; xc.checked = !!p.xcheck; emb.value = p.embedModel !== undefined ? p.embedModel : (presetOf(p.preset).embedModel || ''); syncX();
    status.hidden = true; showProvider(); showList(); };
  const showList = () => {
    plist.textContent = '';
    store.profiles.forEach(p => plist.append(h('label', {}, h('input', { type: 'radio', name: 'set-profile', value: p.id, checked: p.id === sel,
      onchange: () => { grab(); sel = p.id; load(); } }),
      h('span', { class: 'pbody' }, h('span', {}, p.name || 'Model', p.id === store.active ? h('span', { class: 'badge' }, 'In use') : null),
        h('span', { class: 'hint', style: 'display:block' }, [presetLabelOf(p.preset), p.model].filter(Boolean).join(' · '))))));
  };
  const presetLabelOf = id => presetOf(id).label.replace(/\s*\(.*\)\s*$/, '');
  const addBtn = h('button', { class: 'ghost', type: 'button', onclick: () => {
    grab(); const cur = prof();
    const n = { ...cur, id: P.newId(), name: (cur.name || 'Model') + ' copy' };
    store.profiles.push(n); sel = n.id; load(); pname.focus(); pname.select(); } }, '+ New profile');
  const delBtn = confirmBtn('Delete profile', () => {
    if (store.profiles.length < 2) { toast('Keep at least one profile.'); return; }
    store.profiles = store.profiles.filter(x => x.id !== sel);
    if (!store.profiles.some(x => x.id === store.active)) store.active = store.profiles[0].id;
    sel = store.active; P.saveStore(store); load(); });
  const fileIn = h('input', { type: 'file', id: 'set-import-file', accept: 'application/json,.json,text/plain', hidden: true });
  const paste = h('textarea', { id: 'set-import-text', rows: '3', placeholder: 'Or paste a backup here' });
  const doImport = async text => {
    try { const n = await P.importJSON(text); closeSheet(); state.view = { name: 'home' }; toast(`Imported ${n} items.`); }
    catch (e) { toast('That file is not an Afterglow backup.'); }
  };
  fileIn.addEventListener('change', async () => { const f = fileIn.files && fileIn.files[0]; if (f) doImport(await f.text()); });
  openSheet('Settings', [
    h('h3', { class: 'section', style: 'margin-top:0' }, 'Model profiles'),
    h('p', { class: 'sectionnote' }, 'Save a profile for each model you try. Pick one and tap "Use this profile". You can also switch from the story menu.'),
    h('div', { class: 'field' }, plist, h('div', { class: 'row' }, addBtn, delBtn)),
    field('Profile name', pname),
    h('div', { class: 'field' }, h('label', {}, 'Model'), radios, help),
    field('Server address', base),
    h('div', { class: 'field' }, h('label', { for: 'set-key' }, 'API key'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1;min-width:0;display:flex' }, key), showKey), h('span', { class: 'hint' }, 'Stored only on this phone.')),
    field('Model name', model),
    field('Context size (tokens)', ctx, 'How much the model can read at once. For LM Studio or Ollama, use the same number as the model\'s context length (often 8192). The app fits the story, memory and character into it. Leave blank for Claude, Qwen or OpenRouter.'),
    h('div', { class: 'field' }, h('div', { class: 'checks' }, h('label', {}, xm, h('span', { class: 'pbody' }, h('span', {}, 'Experimental memory mode'),
      h('span', { class: 'hint', style: 'display:block' }, 'For local models. Pulls back more old scenes as the context size grows, searches older memories that didn\'t fit, and can match by meaning. Turn off to go back to normal.'))))), embBox,
    h('div', { class: 'field' }, h('button', { class: 'ghost', onclick: async () => {
      grab(); status.hidden = false; status.textContent = 'Testing…';
      try { const r = await P.test({ ...prof() }); status.textContent = 'Connected. The model said: ' + r; }
      catch (e) { status.textContent = errorCopy(e); }
    } }, 'Test connection'), status),
    h('h3', { class: 'section' }, 'Backups'),
    h('p', { class: 'sectionnote' }, P.native ? 'Everything is saved on this phone and backed up automatically to Files › On My iPhone › Afterglow.' : 'Everything is saved in this browser.'),
    h('div', { class: 'field' }, h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => exportAll() }, 'Export backup'), h('button', { class: 'ghost', onclick: () => fileIn.click() }, 'Import backup')), fileIn, paste,
      h('button', { class: 'ghost', onclick: () => { if (paste.value.trim()) doImport(paste.value.trim()); } }, 'Import pasted backup'),
      h('span', { class: 'hint' }, 'Importing replaces everything in the app with the backup.')),
    h('h3', { class: 'section' }, 'App'),
    h('div', { class: 'field' }, h('button', { class: 'ghost', onclick: () => P.reload() }, 'Check for updates'), h('span', { class: 'hint' }, `Version ${P.version}. Updates download automatically when you open the app.`))
  ], [h('button', { class: 'ghost', onclick: closeSheet }, 'Close'), h('button', { class: 'primary', onclick: () => { grab(); store.active = sel; P.saveStore(store); closeSheet(); toast(`Saved. Using ${prof().name}.`); render(); } }, 'Use this profile')]);
  load();
}
function modelMenu() {
  const P = window.TK_PLATFORM; if (!P) return;
  const st = P.getStore();
  const item = p => h('button', { role: 'menuitem', onclick: () => { P.setActive(p.id); closeSheet(); toast(`Using ${p.name}.`); render(); } },
    h('span', {}, p.name || 'Model'), h('span', { class: 'hint' }, p.id === st.active ? '✓' : ''));
  openMenu(h('div', { class: 'menu', role: 'menu', 'aria-label': 'Switch model' },
    h('div', { class: 'preview' }, 'Switch model'), ...st.profiles.map(item), h('div', { class: 'gap' }),
    h('button', { role: 'menuitem', onclick: () => { closeSheet(); setTimeout(settingsSheet, 220); } }, h('span', {}, 'Edit profiles…'), icon('gear'))));
}
async function exportAll() {
  const docs = {};
  for (const [id, v] of state.items) { const { id: _drop, ...rest } = v; docs[id] = rest; }
  const json = JSON.stringify({ app: 'afterglow', version: 1, exportedAt: new Date().toISOString(), docs });
  const name = `afterglow-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
async function seedDefaults() {
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
