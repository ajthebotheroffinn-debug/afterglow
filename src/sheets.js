/* ---------- sheets ---------- */
function openSheet(title, body, foot) {
  const sh = readySheet(false);
  const panel =h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), body, h('div', { class: 'foot' }, foot));
  sh.append(panel); sh.hidden = false;
  sh.onclick = e => { if (e.target === sh) closeSheet(); };
}
let closeTimer = null;
function closeSheet() {
  const sh = $('#sheet'); state.sheetFor = null;
  if (sh.hidden) return;
  sh.classList.add('closing'); clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { sh.hidden = true; sh.textContent = ''; sh.classList.remove('center', 'closing'); }, 190);
}
function readySheet(center) { const sh = $('#sheet'); clearTimeout(closeTimer); sh.classList.remove('closing'); sh.classList.toggle('center', !!center); sh.textContent = ''; return sh; }
function confirmBtn(label, fn) {
  let armed = false;
  const b = h('button', { class: 'ghost danger', onclick: () => { if (armed) return fn(); armed = true; b.textContent = 'Tap again to confirm'; setTimeout(() => { armed = false; b.textContent = label; }, 3000); } }, label);
  return b;
}
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);

function charSheet(id) {
  const c = id ? get(id) : {};
  const name = h('input', { id: 'c-name', value: c.name || '', maxlength: '60', autocomplete: 'off' });
  const persona = h('textarea', { id: 'c-persona', rows: '8', value: c.persona || '' });
  const greet = h('textarea', { id: 'c-greet', rows: '4', value: c.greeting || '' });
  const evo = h('input', { type: 'checkbox', id: 'c-evo', checked: !!c.evolved });
  openSheet(id ? 'Edit character' : 'New character', [
    h('div', { class: 'field' }, h('div', { class: 'checks' }, h('label', {}, evo, 'Evolved: invents their own past and changes over time, different in every story'))),
    id ? h('div', { class: 'field' }, h('button', { class: 'primary', onclick: () => { closeSheet(); setTimeout(() => storySheet(null, [id]), 220); } }, `Start a story with ${c.name}`)) : null,
    field('Name', name),
    field('Personality and background', persona, 'Who they are, how they talk, what they want, what they hide. {{user}} stands for your character.'),
    field('Opening scene (optional)', greet, 'Used as the first message when a new story starts with them.')
  ], [
    id ? confirmBtn('Delete', async () => { await remove(id); closeSheet(); render(); }) : h('span'),
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const n = name.value.trim(); if (!n) { name.focus(); return; }
        const data = { kind: 'char', name: n, persona: persona.value.trim(), greeting: greet.value.trim(), evolved: evo.checked, updatedAt: Date.now() };
        if (id) await save(id, data); else await create('char_' + rid(), data);
        closeSheet(); state.tab = 'characters'; render(); } }, 'Save'))
  ]);
}
function sizeSheet() {
  const rng = h('input', { type: 'range', id: 'tsize', min: '0', max: String(SIZES.length - 1), step: '1', value: String(SIZES.indexOf(textSize)), 'aria-label': 'Text size' });
  const out = h('div', { class: 'lenlabel', 'aria-live': 'polite' });
  const show = () => { textSize = SIZES[+rng.value]; applySize(); out.textContent = `${textSize} pt`; };
  const keep = () => { try { localStorage.setItem('tk-text-size', String(textSize)); } catch (_) {} };
  rng.addEventListener('input', show);
  rng.addEventListener('change', keep);
  show();
  openSheet('Text size', [h('div', { class: 'field' }, out, rng,
    h('div', { class: 'ticks' }, h('span', {}, 'Smaller, more on screen'), h('span', {}, 'Bigger')),
    h('div', { class: 'sizeprev' }, 'She leans forward a little. ', h('b', {}, '"One small true thing each, and nobody makes it weird."')),
    h('span', { class: 'hint' }, 'Changes every chat on this device right away.'))],
    [h('span'), h('button', { class: 'primary', onclick: () => { keep(); closeSheet(); } }, 'Done')]);
}
function lengthSheet(id) {
  const s = get(id); if (!s) return;
  let { mode, maxWords, ri } = lenCfg(s);
  const out = h('div', { class: 'lenlabel', 'aria-live': 'polite' });
  const rng = h('input', { type: 'range', id: 'len', 'aria-label': 'Reply length' });
  const hint = h('span', { class: 'hint' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Length mode' });
  const show = () => {
    if (mode === 'max') { maxWords = +rng.value; out.textContent = `Up to ${maxWords} words`; }
    else { ri = +rng.value; const [a, b] = RANGES[ri]; out.textContent = `${a}–${b} words`; }
  };
  const persist = async () => { await save(id, { lenMode: mode, maxWords, rangeIdx: ri }); paintBar(); };
  const setup = () => {
    tabs.textContent = '';
    [['max', 'Maximum'], ['range', 'Range']].forEach(([m, l]) => tabs.append(h('button', { role: 'tab', 'aria-selected': String(mode === m), onclick: () => { mode = m; setup(); persist(); } }, l)));
    if (mode === 'max') { rng.min = String(MAX_MIN); rng.max = String(MAX_MAX); rng.step = String(MAX_STEP); rng.value = String(maxWords); hint.textContent = 'Replies can be shorter than this, but never longer.'; }
    else { rng.min = '0'; rng.max = String(RANGES.length - 1); rng.step = '1'; rng.value = String(ri); hint.textContent = 'Replies stay between these two numbers.'; }
    show();
  };
  rng.addEventListener('input', show);
  rng.addEventListener('change', persist);
  setup();
  openSheet('Reply length', [tabs, h('div', { class: 'field' }, out, rng,
    h('div', { class: 'ticks' }, h('span', {}, 'Shorter'), h('span', {}, 'Longer')), hint,
    h('span', { class: 'hint' }, 'The replies in your screenshots were about 150 words. Changes apply from the next reply; tap ↻ Retry to redo the last one.'))],
    [h('span'), h('button', { class: 'primary', onclick: async () => { await persist(); closeSheet(); } }, 'Done')]);
}
function personaSheet(id) {
  const p = id ? get(id) : {};
  const name = h('input', { id: 'p-name', value: p.name || '', maxlength: '40', autocomplete: 'off' });
  const gender = h('input', { id: 'p-gender', value: p.gender || '', maxlength: '40', autocomplete: 'off', placeholder: 'Male, Female, Nonbinary…' });
  const desc = h('textarea', { id: 'p-desc', rows: '7', value: p.description || '' });
  const isDef = h('input', { type: 'checkbox', id: 'p-default', checked: id ? !!p.isDefault : !defaultPersona() });
  openSheet(id ? 'Edit persona' : 'New persona', [
    field('Name', name),
    field('Gender', gender),
    field('Description', desc, 'Looks, personality, style, background. Anything the story should know about you.'),
    h('div', { class: 'field' }, h('div', { class: 'checks' }, h('label', {}, isDef, 'Default persona for every story')))
  ], [
    id ? confirmBtn('Delete', async () => { await remove(id); closeSheet(); render(); }) : h('span'),
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const n = name.value.trim(); if (!n) { name.focus(); return; }
        const data = { kind: 'persona', name: n, gender: gender.value.trim(), description: desc.value.trim(), isDefault: isDef.checked, updatedAt: Date.now() };
        const pid = id || 'persona_' + rid();
        if (isDef.checked) for (const o of personas()) if (o.id !== pid && o.isDefault) await save(o.id, { isDefault: false });
        if (id) await save(id, data); else await create(pid, data);
        closeSheet(); state.tab = 'personas'; render(); } }, 'Save'))
  ]);
}
function storySheet(id, preChars) {
  const s = id ? get(id) : { chars: preChars || [] };
  const title = h('input', { id: 's-title', value: s.title || '', maxlength: '80', autocomplete: 'off' });
  const uname = h('input', { id: 's-uname', value: s.userName || '', maxlength: '40', autocomplete: 'off' });
  const you = h('textarea', { id: 's-you', rows: '3', value: s.you || '' });
  const scen = h('textarea', { id: 's-scen', rows: '4', value: s.scenario || '' });
  const pinned = h('textarea', { id: 's-pin', rows: '3', value: s.pinned || '' });
  const cl = chars();
  const checks = h('div', { class: 'checks' }, cl.length ? cl.map(c => h('label', {}, h('input', { type: 'checkbox', value: c.id, checked: (s.chars || []).includes(c.id) }), c.name + (c.evolved ? ' (Evolved)' : ''))) : h('span', { class: 'hint' }, 'No characters yet. The narrator will play everyone.'));
  const curP = id ? (s.personaId && (s.personaId === 'custom' || get(s.personaId)) ? s.personaId : (s.userName ? 'custom' : (defaultPersona()?.id || 'custom'))) : (defaultPersona()?.id || 'custom');
  const customBox = h('div', {}, field('Name', uname, 'Replaces {{user}} everywhere in the story.'), field('About your character', you, 'Look, personality, a line or two of background.'));
  const sync = () => { customBox.hidden = (radios.querySelector('input:checked')?.value || 'custom') !== 'custom'; };
  const radios = h('div', { class: 'checks' },
    personas().map(p => h('label', {}, h('input', { type: 'radio', name: 's-persona', value: p.id, checked: curP === p.id, onchange: sync }), p.name + (p.isDefault ? ' (default)' : ''))),
    h('label', {}, h('input', { type: 'radio', name: 's-persona', value: 'custom', checked: curP === 'custom', onchange: sync }), 'Someone just for this story'));
  sync();
  openSheet(id ? 'Story settings' : 'New story', [
    field('Title', title),
    h('div', { class: 'field' }, h('label', {}, 'You play as'), radios, h('span', { class: 'hint' }, 'Edit personas in the Personas tab on the main screen.')),
    customBox,
    h('div', { class: 'field' }, h('label', {}, 'Characters in this story'), checks),
    field('Scenario', scen, 'Where and when it starts, and what is going on.'),
    field('Pinned notes', pinned, 'Rules or facts the story must always follow.')
  ], [
    id ? confirmBtn('Delete story', async () => { archivesOf(id).forEach(a => remove(a.id)); await remove(id); closeSheet(); state.view = { name: 'home' }; render(); }) : h('span'),
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const picked = [...checks.querySelectorAll('input:checked')].map(x => x.value);
        const data = { title: title.value.trim() || 'Untitled story', personaId: radios.querySelector('input:checked')?.value || 'custom', userName: uname.value.trim(), chars: picked, you: you.value.trim(), scenario: scen.value.trim(), pinned: pinned.value.trim(), updatedAt: Date.now() };
        if (id) { await save(id, data); closeSheet(); render(); return; }
        const opening = picked.map(get).filter(c => c && c.greeting).map(c => ({ id: rid(), role: 'ai', text: picked.length > 1 ? `${c.name}: ${c.greeting}` : c.greeting, ts: Date.now() }));
        const nid = 'story_' + rid();
        await create(nid, { kind: 'story', ...data, ...(picked.some(cid => get(cid)?.evolved) ? { evoSeed: makeEvoSeed() } : {}), messages: opening, memory: mem({}), sinceMemory: opening.length ? MEMORY_EVERY : 0, createdAt: Date.now() });
        closeSheet(); state.view = { name: 'story', id: nid }; render(); } }, id ? 'Save' : 'Start story'))
  ]);
}
function memorySheet(id) {
  const s = get(id); if (!s) return; state.sheetFor = id;
  const m = mem(s);
  const ta = (fid, rows, val) => h('textarea', { id: fid, rows: String(rows), value: val });
  const sum = ta('mem-summary', 6, m.summary);
  const rel = ta('mem-rel', 4, m.relationships.map(r => `${r.name}: ${r.status}`).join('\n'));
  const ppl = ta('mem-people', 6, m.people.join('\n'));
  const wld = ta('mem-world', 5, m.world.join('\n'));
  const thr = ta('mem-threads', 4, m.threads.join('\n'));
  const rev = ta('mem-revealed', 4, m.revealed.join('\n'));
  const inv = ta('mem-invented', 5, m.invented.join('\n'));
  const gro = ta('mem-growth', 3, m.growth.join('\n'));
  const chp = ta('mem-chapters', 4, m.chapters.map(c => `${c.title}: ${c.text}`).join('\n'));
  const pin = ta('mem-pin', 3, s.pinned || '');
  const left = Math.max(0, MEMORY_EVERY - (s.sinceMemory || 0));
  const busy = state.memBusy.has(id);
  openSheet('Story memory', [
    h('div', { class: 'note' }, `Every reply gets this memory, the last ${CONTEXT_TURNS} messages word for word, and up to ${RECALL_COUNT} older moments that match what is happening. ` +
      (s.memoryAt ? `Last updated ${ago(s.memoryAt)}. ` : 'Not built yet. ') + (busy ? 'Updating now.' : `Next automatic update in ${left} message${left === 1 ? '' : 's'}.`)),
    field('Current arc', sum),
    field('Relationships', rel, 'One per line, as Name: where things stand.'),
    field('Character facts', ppl, 'One per line.'),
    field('Places, objects and events', wld, 'One per line.'),
    field('Their past (made up in this story)', inv, 'Memories and backstory the characters brought up. One per line.'),
    field('How they\'ve changed', gro, 'One per line.'),
    field('Secrets revealed so far', rev, 'Hidden things that have already come out. One per line.'),
    field('Open threads', thr, 'Rumors, promises, secrets, plans. One per line.'),
    field('Earlier chapters', chp, 'One per line, as Title: what happened.'),
    h('div', { class: 'field' }, h('label', {}, 'Pinned messages'),
      (s.pinnedMsgs || []).length ? h('div', { class: 'checks' }, s.pinnedMsgs.map(p => {
        const t = subst(p.text, s).replace(/\*/g, '');
        return h('div', { class: 'pinrow' }, h('span', {}, t.length > 140 ? t.slice(0, 140) + '…' : t),
          h('button', { class: 'ghost', onclick: async () => { const cur = get(id); await save(id, { pinnedMsgs: (cur.pinnedMsgs || []).filter(x => x.id !== p.id) }); memorySheet(id); paintStory(); } }, 'Unpin'));
      })) : h('span', { class: 'hint' }, 'Hold any message and tap Pin Message to keep it in memory for good.')),
    field('Pinned notes', pin, 'Always true. Never changed by automatic updates.')
  ], [
    h('button', { class: 'ghost', disabled: !sample || busy, onclick: () => { closeSheet(); updateMemory(id, true); } }, busy ? 'Updating…' : 'Rebuild from story'),
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeSheet }, 'Close'),
      h('button', { class: 'primary', onclick: async () => {
        const pair = l => { const i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, '']; };
        const next = { summary: sum.value.trim(),
          relationships: lines(rel.value).map(l => { const [name, status] = pair(l); return { name, status }; }),
          people: lines(ppl.value), world: lines(wld.value), threads: lines(thr.value), revealed: lines(rev.value), invented: lines(inv.value), growth: lines(gro.value),
          chapters: lines(chp.value).map(l => { const [title, text] = pair(l); return { title, text }; }) };
        await save(id, { memory: next, pinned: pin.value.trim() });
        closeSheet(); toast('Memory saved.'); } }, 'Save'))
  ]);
}
