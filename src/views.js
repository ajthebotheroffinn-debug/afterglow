/* ---------- rendering ---------- */
function render() {
  if (state.view.name === 'story' && !get(state.view.id)) state.view = { name: 'home' };
  const key = state.view.name === 'story' ? 'story:' + state.view.id : 'home';
  const changed = state.lastKey !== undefined && state.lastKey !== key;
  const first = state.lastKey === undefined || state.lastKey === 'loading';
  state.lastKey = state.phase === 'ready' ? key : 'loading';
  paintBar();
  if (state.view.name === 'story') { mountStory(); paintStory(); } else { state.mounted = null; paintHome(); if (changed || first) animateItems(); }
  if (changed) { const v = $('#view'); v.classList.remove('view-in', 'view-back'); void v.offsetWidth; v.classList.add(key === 'home' ? 'view-back' : 'view-in'); }
}
function animateItems() { document.querySelectorAll('#view .item').forEach((el, i) => { el.classList.add('enter'); el.style.animationDelay = Math.min(i, 10) * 35 + 'ms'; }); }
function paintBar() {
  const bar = $('#bar'); bar.textContent = '';
  if (state.view.name === 'story') {
    const s = get(state.view.id); if (!s) return;
    bar.className = 'bar story';
    const cs = storyChars(s);
    const name = cs.map(c => c.name).join(', ') || s.title || 'Story';
    const busy = state.memBusy.has(s.id);
    bar.append(
      h('button', { class: 'circle', 'aria-label': 'Back to library', onclick: () => { if (state.streaming) ctl?.abort(); state.view = { name: 'home' }; render(); } }, icon('back')),
      h('button', { class: 'pill', 'aria-label': 'Story options', onclick: () => storyMenu(s.id) },
        h('span', { class: 'pname' }, name), h('span', { class: 'psub' + (busy ? ' live' : '') }, busy ? 'Remembering…' : lenOf(s).label)),
      h('button', { class: 'circle', 'aria-label': 'Story options', onclick: () => storyMenu(s.id) }, tile(cs[0]?.name || s.title)));
  } else {
    bar.className = 'bar home';
    bar.append(h('h1', {}, 'Afterglow', h('span', { class: 'sub' }, 'Your stories, remembered')),
      state.phase === 'ready' ? (STANDALONE ? h('button', { class: 'chip', onclick: () => settingsSheet() }, 'Settings') : h('button', { class: 'chip', onclick: exportAll }, 'Export for app')) : null);
  }
}
function storyMenu(id) {
  const s = get(id); if (!s) return;
  const c = storyChars(s)[0]; const p = personaOf(s);
  const item = (label, ic, fn) => h('button', { role: 'menuitem', onclick: () => { closeSheet(); fn(); } }, h('span', {}, label), icon(ic));
  openMenu(h('div', { class: 'menu', role: 'menu', 'aria-label': 'Story options' },
    item(`Reply length: ${lenOf(s).label}`, 'len', () => lengthSheet(id)),
    item(`Text size: ${textSize}`, 'size', () => sizeSheet()),
    STANDALONE ? item(`Model: ${window.TK_PLATFORM.getConfig().name || 'not set'}`, 'gear', () => modelMenu()) : null,
    item(state.memBusy.has(id) ? 'Memory (updating…)' : 'Memory', 'book', () => memorySheet(id)),
    item('Story settings', 'gear', () => storySheet(id)),
    c ? item(`Edit ${c.name}`, 'edit', () => charSheet(c.id)) : null,
    item(p ? `Playing as ${p.name}` : 'Choose persona', 'user', () => p ? personaSheet(p.id) : storySheet(id))));
}
function paintHome() {
  const v = $('#view'); v.textContent = '';
  const sc = h('div', { class: 'scroll' }); v.append(sc);
  if (state.phase === 'nodb') { sc.append(h('div', { class: 'empty' }, h('h2', {}, 'Saving is not available here'), h('p', {}, 'Open this page while signed in to claude.ai, with access to edit it, so your stories can be saved.'))); return; }
  if (state.phase === 'loading') { sc.append(h('div', { class: 'empty' }, h('p', {}, state.slow ? 'Your stories can\'t be reached yet. Check your connection.' : 'Loading your stories…'))); return; }
  if (STANDALONE && !window.TK_PLATFORM.isConfigured()) sc.append(h('div', { class: 'banner' }, h('span', {}, 'Pick a model and add your API key to start.'), h('button', { class: 'ghost', onclick: () => settingsSheet() }, 'Settings')));
  else if (!sample) sc.append(h('div', { class: 'note' }, 'Claude replies are not available in this view, so you can read and edit stories but not continue them.'));
  sc.append(h('div', { class: 'tabs', role: 'tablist' },
    [['stories', `Stories (${stories().length})`], ['characters', `Characters (${chars().length})`], ['personas', `Personas (${personas().length})`]]
      .map(([t, label]) => h('button', { role: 'tab', 'aria-selected': String(state.tab === t), onclick: () => { state.tab = t; paintHome(); animateItems(); } }, label))));
  if (state.tab === 'personas') {
    sc.append(h('div', { class: 'note' }, 'A persona is who you are when you play. Your default persona is used in every story unless you pick someone else in that story\'s settings.'));
    sc.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, h('button', { class: 'primary', onclick: () => personaSheet(null) }, '+ New persona')));
    const list = personas();
    if (!list.length) { sc.append(h('div', { class: 'empty' }, h('p', {}, 'Make a persona and the story will know who you are.'))); return; }
    sc.append(h('div', { class: 'list' }, list.map(p => h('button', { class: 'item persona', onclick: () => personaSheet(p.id) }, tile(p.name),
      h('div', { class: 'pbody' }, h('b', {}, p.name, p.isDefault ? h('span', { class: 'badge' }, 'Default') : null),
        h('div', { class: 'snip' }, [p.gender, p.description].filter(Boolean).join(' · ')))))));
    return;
  }
  if (state.tab === 'stories') {
    sc.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, h('button', { class: 'primary', onclick: () => storySheet(null) }, '+ New story'),
      !get('story_valerie') ? h('button', { class: 'ghost', onclick: () => seedPreset('valerie', true) }, 'Add Valerie\'s story') : null));
    const list = stories();
    if (!list.length) { sc.append(h('div', { class: 'empty' }, h('h2', {}, 'No stories yet'), h('p', {}, 'Start a story and Afterglow will remember what happens as it grows.'))); return; }
    sc.append(h('div', { class: 'list' }, list.map(s => {
      const last = (s.messages || []).slice(-1)[0];
      const n = (s.messages || []).length + (s.archivedCount || 0);
      return h('button', { class: 'item persona', onclick: () => { state.view = { name: 'story', id: s.id }; render(); } },
        tile(storyChars(s)[0]?.name || s.title),
        h('div', { class: 'pbody' },
          h('b', {}, s.title || 'Untitled story'),
          h('span', { class: 'meta' }, [storyChars(s).map(c => c.name).join(', ') || 'Narrator only', `${n} message${n === 1 ? '' : 's'}`, ago(s.updatedAt)].join(' · ')),
          last ? h('div', { class: 'snip' }, subst(last.text, s).replace(/\*/g, '').slice(-300)) : null));
    })));
  } else {
    sc.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, h('button', { class: 'primary', onclick: () => charSheet(null) }, '+ New character')));
    const list = chars();
    if (!list.length) { sc.append(h('div', { class: 'empty' }, h('p', {}, 'Characters you make show up here and can join any story.'))); return; }
    const card = c => h('button', { class: 'item persona', onclick: () => charSheet(c.id) }, tile(c.name),
      h('div', { class: 'pbody' }, h('b', {}, c.name, c.evolved ? h('span', { class: 'badge evo' }, 'Evolved') : null), h('div', { class: 'snip' }, String(c.persona || '').replace(/\{\{user\}\}/gi, defaultPersona()?.name || 'you'))));
    const evo = list.filter(c => c.evolved), std = list.filter(c => !c.evolved);
    if (evo.length) sc.append(h('h3', { class: 'section' }, 'Evolved'), h('p', { class: 'sectionnote' }, 'They invent their own past as the story goes and remember it, so every story with them turns out different.'), h('div', { class: 'list' }, evo.map(card)));
    if (std.length) sc.append(h('h3', { class: 'section' }, 'Standard'), h('div', { class: 'list' }, std.map(card)));
  }
}
function mountStory() {
  if (state.mounted === state.view.id) return;
  state.mounted = state.view.id;
  state.seen = new Set((get(state.view.id)?.messages || []).map(m => m.id));
  const v = $('#view'); v.textContent = '';
  const box = h('textarea', { id: 'say', rows: '1', placeholder: 'Message', 'aria-label': 'Your message. Send it empty to let the story continue.',
    oninput: e => autosize(e.target),
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); send(); } } });
  const sendBtn = h('button', { class: 'send', id: 'sendbtn', type: 'button', 'aria-label': 'Continue the story' });
  sendBtn.innerHTML = SEND_SVG; sendBtn.dataset.mode = 'continue';
  // Keep the keyboard up: stop the button from stealing focus, so nothing shifts and one tap sends.
  sendBtn.addEventListener('pointerdown', e => e.preventDefault());
  sendBtn.addEventListener('mousedown', e => e.preventDefault());
  sendBtn.addEventListener('click', () => {
    if (state.streaming) { ctl?.abort(); return; }
    const hadFocus = document.activeElement === box;
    send(); if (hadFocus) box.focus({ preventScroll: true });
  });
  v.append(h('div', { class: 'scroll chat', id: 'scroller' }, h('div', { class: 'msgs', id: 'msgs' })),
    h('div', { class: 'composer' }, h('div', { class: 'cbox' }, box, sendBtn), h('div', { class: 'disclaimer' }, 'This is AI, not a human.')));
  state.forceBottom = true;
}
function autosize(el) {
  el.style.height = '35px';
  const want = Math.min(Math.max(el.scrollHeight, 35), 140);
  el.style.height = want + 'px';
  el.style.overflowY = el.scrollHeight > 140 ? 'auto' : 'hidden';
  updateSendBtn();
}
function updateSendBtn() {
  const btn = $('#sendbtn'), box = $('#say'); if (!btn) return;
  const mode = state.streaming ? 'stop' : (box && box.value.trim() ? 'go' : 'continue');
  if (btn.dataset.mode === mode) return;
  btn.dataset.mode = mode;
  btn.classList.toggle('go', mode === 'go');
  btn.innerHTML = mode === 'stop' ? STOP_SVG : mode === 'go' ? ARROW_SVG : SEND_SVG;
  btn.setAttribute('aria-label', mode === 'stop' ? 'Stop' : mode === 'go' ? 'Send' : 'Continue the story');
}
function paintStory() {
  if (state.view.name !== 'story') return;
  const s = get(state.view.id); const wrap = $('#msgs'); if (!s || !wrap) return;
  const sc = $('#scroller'); const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  wrap.textContent = '';
  if (!youName(s)) wrap.append(h('div', { class: 'banner' }, h('span', {}, 'Pick who you play in this story.'), h('button', { class: 'ghost', onclick: () => storySheet(s.id) }, 'Choose persona')));
  if (s.archivedCount) wrap.append(h('div', { class: 'older' }, `${s.archivedCount} earlier messages are archived. The story still remembers them.`));
  const msgs = s.messages || [];
  if (!msgs.length && !state.streaming) wrap.append(h('div', { class: 'empty' }, h('p', {}, 'Write the first line of the story below, or just press Send and the story will open the scene.')));
  const pinnedIds = new Set((s.pinnedMsgs || []).map(p => p.id));
  const charName = storyChars(s)[0]?.name || s.title || 'Story';
  msgs.forEach((m, i) => {
    const isLast = i === msgs.length - 1;
    const el = h('div', { class: 'msg tap ' + (m.role === 'user' ? 'user' : 'ai'), tabindex: '0', 'aria-haspopup': 'menu',
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); msgMenu(m.id); } } });
    el.innerHTML = (pinnedIds.has(m.id) ? '<span class="pinmark">Pinned</span>' : '') + (m.role === 'user' ? fmt : fmtAI)(subst(m.text, s));
    attachPress(el, () => msgMenu(m.id));
    if (isLast && m.role === 'ai' && i > 0 && !state.streaming && sample) el.append(h('div', { class: 'acts' }, h('button', { onclick: retry }, '↻ Retry')));
    const isNew = state.seen && !state.seen.has(m.id); if (state.seen) state.seen.add(m.id);
    wrap.append(m.role === 'user' ? h('div', { class: 'mrow user' + (isNew ? ' enter' : '') }, el, tile(youName(s) || 'You', 'av', YOU_COLOR))
      : h('div', { class: 'mrow ai' + (isNew ? ' enter' : '') }, tile(charName, 'av'), el));
  });
  if (state.streaming && state.streaming.id === s.id) {
    const el = h('div', { class: 'msg ai', id: 'stream' });
    if (state.streaming.text) el.innerHTML = fmtAI(subst(state.streaming.text, s));
    else {
      el.append(h('span', { class: 'typing', role: 'status', 'aria-label': state.streaming.phase === 'checking' ? 'Checking memory' : 'Writing' }, h('i'), h('i'), h('i')));
      if (state.streaming.phase === 'checking') el.append(h('span', { class: 'thinking', style: 'margin-left:8px;font-size:.85em' }, 'Checking memory…'));
    }
    const first = !state.streaming.shown; state.streaming.shown = true;
    wrap.append(h('div', { class: 'mrow ai' + (first ? ' enter' : '') }, tile(charName, 'av'), el));
  }
  const btn = $('#sendbtn'); if (btn) { updateSendBtn(); btn.disabled = !sample && !state.streaming; }
  if (near || state.forceBottom || state.streaming) { sc.scrollTop = sc.scrollHeight; state.forceBottom = false; }
}
function paintStream() {
  const el = $('#stream'); if (!el) return paintStory();
  const sc = $('#scroller'); const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  el.innerHTML = fmtAI(subst(state.streaming.text, get(state.streaming.id)));
  if (near) sc.scrollTop = sc.scrollHeight;
}

/* ---------- message actions ---------- */
function attachPress(el, fn) {
  // Press and hold opens the menu. A quick tap does nothing. Right-click opens it on a computer.
  let t = null, fired = false, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(t); el.classList.remove('pressing'); };
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.acts') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    fired = false; sx = e.clientX; sy = e.clientY;
    el.classList.add('pressing');
    t = setTimeout(() => {
      fired = true; el.classList.remove('pressing'); el.classList.add('held');
      try { navigator.vibrate && navigator.vibrate(12); } catch (_) {}
      try { window.TK_PLATFORM?.haptic?.(); } catch (_) {}
      fn(); setTimeout(() => el.classList.remove('held'), 260);
    }, 420);
  });
  el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, cancel));
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); fired = false; } });
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (!fired) fn(); });
}
const ICONS = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
  pin: '<path d="M9 3h6l-1 6 4 4H6l4-4-1-6z"/><path d="M12 13v8"/>',
  branch: '<path d="M6 3v3a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><path d="M12 12v9"/><path d="M3 6l3-3 3 3"/><path d="M15 6l3-3 3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  back: '<path d="M15 4l-8 8 8 8"/>',
  rewind: '<path d="M11 6l-7 6 7 6V6z"/><path d="M20 6l-7 6 7 6V6z"/>',
  len: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  size: '<path d="M3 19l5-14 5 14M5 14h6"/><path d="M14 19l3.5-9 3.5 9M15.2 16h4.6"/>'
};
const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M5.5 11.5L12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEND_SVG = '<svg viewBox="0 0 30 20" aria-hidden="true"><path d="M2 2l12 8-12 8z M15 2l12 8-12 8z" fill="currentColor"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 30 20" aria-hidden="true"><rect x="9" y="4" width="12" height="12" rx="2" fill="currentColor"/></svg>';
const icon = n => { const sp = h('span', { class: 'ic', 'aria-hidden': 'true' }); sp.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`; return sp; };
function openMenu(menu) {
  const sh = readySheet(true);
  sh.append(menu); sh.hidden = false;
  sh.onclick = e => { if (e.target === sh) closeSheet(); };
  const first = menu.querySelector('button'); if (first) first.focus({ preventScroll: true });
}
function msgMenu(mid) {
  const s = get(state.view.id); if (!s) return;
  const m = (s.messages || []).find(x => x.id === mid); if (!m) return;
  const pinned = (s.pinnedMsgs || []).some(p => p.id === mid);
  const item = (label, ic, fn) => h('button', { role: 'menuitem', onclick: () => { closeSheet(); fn(); } }, h('span', {}, label), icon(ic));
  const msgs = s.messages || [];
  const isLastMsg = msgs[msgs.length - 1]?.id === mid;
  const later = msgs.length - 1 - msgs.findIndex(x => x.id === mid);
  let rewArmed = false;
  const rewLabel = h('span', {}, 'Rewind to Here');
  const rew = h('button', { role: 'menuitem', onclick: () => {
    if (!rewArmed) { rewArmed = true; rewLabel.textContent = `Tap again to remove ${later} later message${later === 1 ? '' : 's'}`; return; }
    closeSheet(); rewindTo(mid); } }, rewLabel, icon('rewind'));
  let armed = false;
  const delLabel = h('span', {}, 'Delete');
  const del = h('button', { role: 'menuitem', class: 'danger', onclick: () => {
    if (!armed) { armed = true; delLabel.textContent = 'Tap again to delete'; return; }
    closeSheet(); delMsg(mid); } }, delLabel, icon('trash'));
  openMenu(h('div', { class: 'menu', role: 'menu', 'aria-label': 'Message options' },
    h('div', { class: 'preview' }, subst(m.text, s).replace(/\*/g, '').slice(0, 220)),
    item('Copy', 'copy', () => copyText(subst(m.text, s))),
    item('Edit', 'edit', () => editMsg(mid)),
    item(pinned ? 'Unpin Message' : 'Pin Message', 'pin', () => togglePin(mid)),
    state.streaming ? null : item('New Chat from Here', 'branch', () => branch(mid)),
    state.streaming || isLastMsg ? null : rew,
    h('div', { class: 'gap' }),
    del));
}
function copyText(t) {
  try { navigator.clipboard.writeText(t).then(() => toast('Copied.'), () => copyFallback(t)); }
  catch (_) { copyFallback(t); }
}
function copyFallback(t) {
  const ta = h('textarea', { id: 'copy-text', rows: '8', value: t, readonly: true });
  openSheet('Copy message', [h('div', { class: 'field' }, ta, h('span', { class: 'hint' }, 'Copying was blocked here. Select the text and copy it.'))], [h('span'), h('button', { class: 'primary', onclick: closeSheet }, 'Done')]);
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}
async function rewindTo(mid) {
  const s = get(state.view.id); if (!s || state.streaming) return;
  const msgs = s.messages || []; const i = msgs.findIndex(x => x.id === mid); if (i < 0) return;
  const removed = new Set(msgs.slice(i + 1).map(m => m.id)); if (!removed.size) return;
  await save(s.id, { messages: msgs.slice(0, i + 1), pinnedMsgs: (s.pinnedMsgs || []).filter(p => !removed.has(p.id)), sinceMemory: 0, updatedAt: Date.now() });
  state.forceBottom = true; paintStory();
  toast(`Rewound. ${removed.size} later message${removed.size === 1 ? '' : 's'} removed; memory is catching up.`);
  updateMemory(s.id, false, true);
}
async function togglePin(mid) {
  const s = get(state.view.id); const m = (s.messages || []).find(x => x.id === mid); if (!m) return;
  let pins = [...(s.pinnedMsgs || [])];
  if (pins.some(p => p.id === mid)) { pins = pins.filter(p => p.id !== mid); await save(s.id, { pinnedMsgs: pins }); toast('Unpinned.'); }
  else {
    if (pins.length >= 20) { toast('You can pin up to 20 messages. Unpin one in Memory first.'); return; }
    pins.push({ id: mid, text: m.text }); await save(s.id, { pinnedMsgs: pins }); toast('Pinned. The story will always remember this.');
  }
  paintStory();
}
async function branch(mid) {
  const s = get(state.view.id); const msgs = s.messages || []; const i = msgs.findIndex(x => x.id === mid); if (i < 0) return;
  const all = [...archivesOf(s.id).flatMap(a => a.messages || []), ...msgs.slice(0, i + 1)];
  const keep = new Set(all.map(m => m.id));
  const nid = 'story_' + rid();
  let rest = all, seq = 0;
  while (rest.length > ARCHIVE_AT - ARCHIVE_CHUNK) {
    seq++;
    await create(`arch_${nid}_${seq}`, { kind: 'arch', storyId: nid, seq, messages: rest.slice(0, ARCHIVE_CHUNK), createdAt: Date.now() });
    rest = rest.slice(ARCHIVE_CHUNK);
  }
  const isEnd = i === msgs.length - 1;
  await create(nid, { kind: 'story', title: (s.title || 'Untitled story').replace(/ \(branch\)$/, '') + ' (branch)', userName: s.userName || '', personaId: s.personaId || '',
    chars: s.chars || [], you: s.you || '', scenario: s.scenario || '', pinned: s.pinned || '',
    pinnedMsgs: (s.pinnedMsgs || []).filter(p => keep.has(p.id)), messages: rest, archiveSeq: seq, archivedCount: seq * ARCHIVE_CHUNK,
    memory: mem(s), sinceMemory: 0, branchedFrom: s.id, createdAt: Date.now(), updatedAt: Date.now() });
  state.view = { name: 'story', id: nid }; render();
  toast(isEnd ? 'New chat started from here.' : 'New chat started from here. Its memory is catching up.');
  if (!isEnd) updateMemory(nid, false, true);
}
function editMsg(mid) {
  const s = get(state.view.id); const m = (s.messages || []).find(x => x.id === mid); if (!m) return;
  const ta = h('textarea', { id: 'edit-text', rows: '8', value: m.text });
  openSheet('Edit message', [h('div', { class: 'field' }, ta)], [
    h('button', { class: 'ghost', onclick: closeSheet }, 'Cancel'),
    h('button', { class: 'primary', onclick: async () => {
      const t = ta.value.trim(); if (!t) return;
      const cur = get(state.view.id);
      await save(cur.id, { messages: (cur.messages || []).map(x => x.id === mid ? { ...x, text: t } : x),
        pinnedMsgs: (cur.pinnedMsgs || []).map(p => p.id === mid ? { ...p, text: t } : p) });
      closeSheet(); paintStory(); } }, 'Save')]);
}
async function delMsg(mid) {
  const s = get(state.view.id);
  await save(s.id, { messages: (s.messages || []).filter(x => x.id !== mid), pinnedMsgs: (s.pinnedMsgs || []).filter(p => p.id !== mid) });
  paintStory(); toast('Message deleted.');
}
