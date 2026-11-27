const $ = s => document.querySelector(s);
const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c.nodeType ? c : String(c)); }
  return el;
};
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/\*([^*\n]+)$/gm, '<em>$1</em>');
// AI replies: narration muted, spoken dialogue (in quotes) in full color.
const fmtAI = t => String(t).split(/(“[^”]*”|"[^"\n]*")/g)
  .map((seg, i) => !seg ? '' : i % 2 ? `<span class="say">${fmt(seg)}</span>` : `<span class="narr">${fmt(seg)}</span>`).join('');
const RANGES = [[20, 40], [40, 70], [70, 100], [100, 130], [130, 170], [170, 220], [220, 280], [280, 350], [350, 450], [450, 600]];
const MAX_MIN = 25, MAX_MAX = 600, MAX_STEP = 25;
const OLD_MAX = [70, 110, 180, 300, 450]; // for stories saved with the old five-step setting
function lenCfg(s) {
  const mode = s && s.lenMode === 'range' ? 'range' : 'max';
  let maxWords = s && Number.isFinite(s.maxWords) ? s.maxWords : Number.isInteger(s && s.replyLen) ? OLD_MAX[Math.max(0, Math.min(4, s.replyLen))] : 150;
  maxWords = Math.min(MAX_MAX, Math.max(MAX_MIN, Math.round(maxWords / MAX_STEP) * MAX_STEP));
  const ri = s && Number.isInteger(s.rangeIdx) ? Math.max(0, Math.min(RANGES.length - 1, s.rangeIdx)) : 4;
  return { mode, maxWords, ri };
}
// Split the player's message into what is said out loud and what is an action, thought or direction (after a *).
function labelUser(text, you) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) continue;
    const quoted = /["“”]/.test(para);
    para.split('*').forEach((seg, i) => {
      if (!seg.trim()) return;
      if (i % 2 === 0 && !quoted) { out.push(`${you} says out loud: ${seg.trim()}`); return; }
      seg.split(/(“[^”]*”|"[^"\n]*")/g).forEach((x, j) => {
        const y = x.trim(); if (!y) return;
        out.push(j % 2 ? `${you} says out loud: ${y}` : `${you} [action/thought]: ${y}`);
      });
    });
  }
  return out.join('\n') || String(text || '');
}
function lenOf(s) {
  const c = lenCfg(s);
  if (c.mode === 'range') { const [a, b] = RANGES[c.ri]; return { label: `${a}–${b} words`, prompt: `between ${a} and ${b} words. Stay inside this range every time` }; }
  return { label: `Up to ${c.maxWords} words`, prompt: `at most ${c.maxWords} words. This is a ceiling, not a target: go shorter whenever the moment works better short, but never go over` };
}
const SIZES = [12, 13, 14, 15, 16, 17, 19, 21];
let textSize = 15;
try { const v = parseInt(localStorage.getItem('tk-text-size'), 10); if (SIZES.includes(v)) textSize = v; } catch (_) {}
const applySize = () => document.documentElement.style.setProperty('--msg-size', textSize + 'px');
applySize();
// In the newer iPhone app the chat scrolls with iPhone's own scrolling, so the keyboard can follow
// your finger down and spring back up (like Messages). Older app builds keep the in-page scroller.
const NATIVE_SCROLL = !!window.TK_NATIVE_SCROLL;
const docScroll = () => document.documentElement.classList.contains('docscroll');
const chatScroller = () => docScroll() ? document.scrollingElement : $('#scroller');
document.addEventListener('focusin', e => {
  if (e.target && e.target.id === 'say') {
    document.documentElement.classList.add('kb');
    setTimeout(() => { const sc = chatScroller(); if (sc) sc.scrollTop = sc.scrollHeight; }, 300);
  }
});
document.addEventListener('focusout', e => { if (e.target && e.target.id === 'say') document.documentElement.classList.remove('kb'); });
// Swipe-down keyboard dismiss, like iOS chat apps: while typing, drag down through the chat;
// once your finger reaches the message box (the top of the keyboard), the keyboard goes away.
(() => {
  let startY = null, lastY = null;
  const typing = () => document.activeElement && document.activeElement.id === 'say';
  document.addEventListener('touchstart', e => {
    if (NATIVE_SCROLL) { startY = null; return; }   // the iPhone handles it
    if (!typing() || !e.target.closest || !e.target.closest('#scroller, .composer')) { startY = null; return; }
    startY = lastY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (startY === null || !typing()) return;
    const y = e.touches[0].clientY, down = y > lastY; lastY = y;
    if (!down || y - startY < 12) return;
    const box = document.querySelector('.cbox'); if (!box) return;
    if (y >= box.getBoundingClientRect().top - 4) { document.activeElement.blur(); startY = null; }
  }, { passive: true });
  document.addEventListener('touchend', () => { startY = null; }, { passive: true });
})();
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ago = ts => { if (!ts) return ''; const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const hr = Math.round(m / 60);
  if (hr < 24) return hr + ' h ago'; return Math.round(hr / 24) + ' d ago'; };
const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
const strArr = (a, n) => Array.isArray(a) ? a.map(x => String(x).trim()).filter(Boolean).slice(0, n) : [];

const STANDALONE = !!window.TK_PLATFORM; // running as the phone app, with on-device storage
const CONTEXT_TURNS = 40;    // recent messages sent word for word with each reply
const MEMORY_EVERY = 8;      // messages between automatic memory updates
const ARCHIVE_AT = STANDALONE ? 1e9 : 240;  // on the phone nothing is ever trimmed
const ARCHIVE_CHUNK = 100;   // ...the oldest this many move to an archive page (still searchable)
const RECALL_COUNT = STANDALONE ? 6 : 4;    // older moments pulled back in when they matter
const LIM = STANDALONE
  ? { chapters: 80, people: 120, world: 120, threads: 60, revealed: 100, invented: 150, growth: 50, take: 80 }
  : { chapters: 30, people: 40, world: 40, threads: 25, revealed: 40, invented: 60, growth: 25, take: 60 };
