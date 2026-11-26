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
  const cfg = P.getConfig();
  const presets = P.presets;
  let pick = cfg.preset || presets[0].id;
  const radios = h('div', { class: 'checks' });
  const base = h('input', { id: 'set-base', value: cfg.baseUrl || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' });
  const key = h('input', { id: 'set-key', type: 'password', value: cfg.apiKey || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const model = h('input', { id: 'set-model', value: cfg.model || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const help = h('span', { class: 'hint' });
  const status = h('div', { class: 'note', 'aria-live': 'polite', hidden: true });
  const showKey = h('button', { class: 'ghost', type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; showKey.textContent = key.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  const fill = (keepFields) => {
    const pr = presets.find(x => x.id === pick) || presets[0];
    if (!keepFields) { base.value = pr.baseUrl; model.value = pr.model; }
    help.textContent = pr.help || '';
  };
  presets.forEach(pr => radios.append(h('label', {}, h('input', { type: 'radio', name: 'set-preset', value: pr.id, checked: pick === pr.id, onchange: () => { pick = pr.id; fill(false); } }), pr.label)));
  fill(!!cfg.baseUrl && cfg.preset === pick);
  const current = () => ({ preset: pick, kind: (presets.find(x => x.id === pick) || presets[0]).kind, baseUrl: base.value.trim().replace(/\/+$/, ''), apiKey: key.value.trim(), model: model.value.trim() });
  const fileIn = h('input', { type: 'file', id: 'set-import-file', accept: 'application/json,.json,text/plain', hidden: true });
  const paste = h('textarea', { id: 'set-import-text', rows: '3', placeholder: 'Or paste a backup here' });
  const doImport = async text => {
    try { const n = await P.importJSON(text); closeSheet(); state.view = { name: 'home' }; toast(`Imported ${n} items.`); }
    catch (e) { toast('That file is not an Afterglow backup.'); }
  };
  fileIn.addEventListener('change', async () => { const f = fileIn.files && fileIn.files[0]; if (f) doImport(await f.text()); });
  openSheet('Settings', [
    h('div', { class: 'field' }, h('label', {}, 'Model'), radios, help),
    field('Server address', base),
    h('div', { class: 'field' }, h('label', { for: 'set-key' }, 'API key'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1;min-width:0;display:flex' }, key), showKey), h('span', { class: 'hint' }, 'Stored only on this phone.')),
    field('Model name', model),
    h('div', { class: 'field' }, h('button', { class: 'ghost', onclick: async () => {
      P.setConfig(current()); status.hidden = false; status.textContent = 'Testing…';
      try { const r = await P.test(); status.textContent = 'Connected. The model said: ' + r; }
      catch (e) { status.textContent = errorCopy(e); }
    } }, 'Test connection'), status),
    h('h3', { class: 'section' }, 'Backups'),
    h('p', { class: 'sectionnote' }, P.native ? 'Everything is saved on this phone and backed up automatically to Files › On My iPhone › Afterglow.' : 'Everything is saved in this browser.'),
    h('div', { class: 'field' }, h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => exportAll() }, 'Export backup'), h('button', { class: 'ghost', onclick: () => fileIn.click() }, 'Import backup')), fileIn, paste,
      h('button', { class: 'ghost', onclick: () => { if (paste.value.trim()) doImport(paste.value.trim()); } }, 'Import pasted backup'),
      h('span', { class: 'hint' }, 'Importing replaces everything in the app with the backup.')),
    h('h3', { class: 'section' }, 'App'),
    h('div', { class: 'field' }, h('button', { class: 'ghost', onclick: () => P.reload() }, 'Check for updates'), h('span', { class: 'hint' }, `Version ${P.version}. Updates download automatically when you open the app.`))
  ], [h('button', { class: 'ghost', onclick: closeSheet }, 'Close'), h('button', { class: 'primary', onclick: () => { P.setConfig(current()); closeSheet(); toast('Saved.'); render(); } }, 'Save')]);
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
