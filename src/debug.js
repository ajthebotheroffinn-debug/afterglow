/* ---------- debug log (Settings › Debug log) ----------
   Keeps the last replies and memory updates: exactly what was sent to the model, what came back,
   how long it took and any error. "Share debug report" bundles it with the open story's memory
   so it can be sent to Claude to diagnose problems. API keys are never included. */
const DEBUG_KEY = 'tk-debug-log', DEBUG_MAX = 40, DEBUG_BYTES = 1500000;
let debugLog = [];
try { debugLog = JSON.parse(localStorage.getItem(DEBUG_KEY) || '[]'); if (!Array.isArray(debugLog)) debugLog = []; } catch (_) { debugLog = []; }
function debugSave() {
  let s = JSON.stringify(debugLog);
  while (s.length > DEBUG_BYTES && debugLog.length > 1) { debugLog.shift(); s = JSON.stringify(debugLog); }
  try { localStorage.setItem(DEBUG_KEY, s); } catch (_) {}
}
function dlog(entry) {
  const e = { t: new Date().toISOString(), ...entry };
  debugLog.push(e); while (debugLog.length > DEBUG_MAX) debugLog.shift();
  debugSave(); return e;
}
// Things you did in the story (rewinds, edits, deletes...), so a report shows what led up to a problem.
const preview = t => String(t || '').replace(/\s+/g, ' ').slice(0, 120);
const msgInfo = mid => { const s = get(state.view.id); const msgs = (s && s.messages) || []; const i = msgs.findIndex(m => m.id === mid);
  return i < 0 ? { mid } : { mid, index: i, of: msgs.length, role: msgs[i].role, text: preview(msgs[i].text) }; };
const devent = (what, extra) => dlog({ kind: 'event', what, story: state.view.name === 'story' ? state.view.id : null, ...extra });
{
  const _rewind = rewindTo, _branch = branch, _del = delMsg, _pin = togglePin, _retry = retry, _mem = updateMemory;
  rewindTo = mid => { devent('rewind', { to: msgInfo(mid) }); return _rewind(mid); };
  branch = mid => { devent('new chat from here', { from: msgInfo(mid) }); return _branch(mid); };
  delMsg = mid => { devent('delete message', { msg: msgInfo(mid) }); return _del(mid); };
  togglePin = mid => { devent('pin/unpin', { msg: msgInfo(mid) }); return _pin(mid); };
  retry = () => { devent('retry'); return _retry(); };
  updateMemory = (id, manual, rewound) => { devent('memory update started', { manual: !!manual, afterRewind: !!rewound }); return _mem(id, manual, rewound); };
}
// Page errors (bugs in the app itself).
window.addEventListener('error', e => dlog({ kind: 'page error', message: String(e.message || e.error), where: `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}` }));
window.addEventListener('unhandledrejection', e => { const r = e.reason || {}; dlog({ kind: 'page error', message: String(r.message || r.code || r), stack: r.stack ? String(r.stack).slice(0, 600) : undefined }); });
// Runs one model call and records it.
function debugCall(kind, input, opts, run) {
  const P = window.TK_PLATFORM, cfg = P ? P.getConfig() : {};
  const e = dlog({ kind, story: state.view.name === 'story' ? state.view.id : null, model: cfg.model || '', profile: cfg.name || '',
    budget: P && P.budget ? P.budget() : 0, maxTokens: opts && opts.maxTokens || null, input });
  const t0 = performance.now();
  e.markFirst = () => { if (e.firstWordMs == null) e.firstWordMs = Math.round(performance.now() - t0); };
  const p = run(e);
  Promise.resolve(p).then(r => { e.ms = Math.round(performance.now() - t0); e.out = r && typeof r === 'object' && 'text' in r ? r.text : r; debugSave(); },
    err => { e.ms = Math.round(performance.now() - t0); e.error = { code: err && err.code, message: err && err.message, partial: err && err.text }; debugSave(); });
  return p;
}
let debugNote = '';
function debugReport() {
  const P = window.TK_PLATFORM;
  // The open story, or else the story the most recent log entry was about.
  const lastStory = [...debugLog].reverse().find(e => e.story && get(e.story));
  const s = (state.view.name === 'story' && get(state.view.id)) || (lastStory ? get(lastStory.story) : null);
  const strip = o => { if (!o) return o; const { apiKey, ...rest } = o; return rest; };
  return JSON.stringify({
    app: 'DreamScapes', version: APP_VERSION, when: new Date().toISOString(), device: navigator.userAgent,
    whatWentWrong: debugNote || '',
    nativeApp: !!(P && P.native), nativeComposer: typeof NATIVE_COMPOSER !== 'undefined' && NATIVE_COMPOSER,
    profile: P ? strip(P.getConfig()) : null, budget: P && P.budget ? P.budget() : 0,
    settings: { replyTimer: replyTimerOn, yourActions: s ? CTL_LEVELS[ctlOf(s).act] : null, yourSpeech: s ? CTL_LEVELS[ctlOf(s).speak] : null },
    story: s ? { id: s.id, title: s.title, messages: (s.messages || []).length, archived: s.archivedCount || 0, sinceMemory: s.sinceMemory || 0,
      memoryAt: s.memoryAt ? new Date(s.memoryAt).toISOString() : null, pinned: s.pinned || '', memory: s.memory || null,
      scenario: s.scenario || '', characters: storyChars(s).map(c => c.name), playingAs: youName(s),
      pinnedMessages: (s.pinnedMsgs || []).map(p => p.text),
      transcript: (s.messages || []).map((m, i) => ({ i, id: m.id, role: m.role, at: m.ts ? new Date(m.ts).toISOString() : null, text: m.text })) } : null,
    log: debugLog
  }, null, 1);
}
function debugPage(group) {
  const list = h('div', { class: 'dlog' });
  const fill = () => {
    list.textContent = '';
    if (!debugLog.length) { list.append(h('p', { class: 'sectionnote' }, 'Nothing logged yet. Send a message in a story, then come back.')); return; }
    [...debugLog].reverse().forEach(e => {
      if (e.kind === 'event' || e.kind === 'page error') {
        list.append(h('div', { class: 'devent' + (e.kind === 'page error' ? ' err' : '') }, `${new Date(e.t).toLocaleTimeString()} · ${e.kind === 'event' ? e.what : 'App error: ' + e.message}`));
        return;
      }
      const head = `${new Date(e.t).toLocaleTimeString()} · ${e.kind === 'reply' ? 'Reply' : e.kind === 'memory' ? 'Memory update' : e.kind}` +
        (e.ms != null ? ` · ${(e.ms / 1000).toFixed(1)}s` : ' · running') + (e.firstWordMs != null ? ` (first word ${(e.firstWordMs / 1000).toFixed(1)}s)` : '') + (e.error ? ' · error' : '');
      const sent = Array.isArray(e.input) ? e.input.map(m => `[${m.role}]\n${m.content}`).join('\n\n') : String(e.input || '');
      list.append(h('details', { class: 'dentry' + (e.error ? ' err' : '') },
        h('summary', {}, head),
        h('div', { class: 'dmeta' }, `${e.profile || ''} · ${e.model || ''}${e.budget ? ' · context ' + e.budget : ''} · sent ≈${Math.round(sent.length / 3.2)} tokens`),
        e.error ? h('pre', { class: 'dpre' }, 'ERROR ' + (e.error.code || '') + ': ' + (e.error.message || '')) : null,
        h('div', { class: 'dlabel' }, 'Came back'), h('pre', { class: 'dpre' }, typeof e.out === 'string' ? e.out : JSON.stringify(e.out, null, 1) || '(nothing yet)'),
        h('div', { class: 'dlabel' }, 'Sent to the model'), h('pre', { class: 'dpre' }, sent)));
    });
  };
  fill();
  const copy = async () => {
    const text = debugReport();
    try { await navigator.clipboard.writeText(text); toast('Debug report copied. Paste it to Claude.'); }
    catch (_) { toast('Copying was blocked. Use Share debug report instead.'); }
  };
  const share = async () => {
    const name = `dreamscapes-debug-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    try { if (downloads) { await downloads.save({ filename: name, data: debugReport() }); return; } } catch (_) {}
    copy();
  };
  const note = h('textarea', { id: 'debug-note', rows: '3', placeholder: 'What went wrong? e.g. "rewound to the friend group, but the reply was back in the classroom"', value: debugNote,
    oninput: e => { debugNote = e.target.value; } });
  return { title: 'Debug log', body: [
    h('p', { class: 'sectionnote' }, `The last ${DEBUG_MAX} replies and memory updates: exactly what was sent to the model, what came back, and how long it took. The report includes the story you were last in (its memory and every message). API keys are never included.`),
    h('div', { class: 'field' }, h('label', { for: 'debug-note' }, 'What went wrong (optional)'), note),
    group(null, [
      h('button', { class: 'srow nav accent', type: 'button', onclick: share }, 'Share debug report'),
      h('button', { class: 'srow nav accent', type: 'button', onclick: copy }, 'Copy debug report'),
      h('button', { class: 'srow nav danger', type: 'button', onclick: () => { debugLog = []; debugSave(); fill(); toast('Debug log cleared.'); } }, 'Clear log')
    ]),
    h('h3', { class: 'section' }, 'Recent'),
    list
  ] };
}
