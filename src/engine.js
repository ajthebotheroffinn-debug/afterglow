const state = { phase: 'loading', items: new Map(), view: { name: 'home' }, tab: 'stories',
  streaming: null, openMsg: null, memBusy: new Set(), mounted: null, seeding: false };
let db = null, col = null, sample = null, ctl = null;
const writeQ = {};

const stories = () => [...state.items.values()].filter(x => x.kind === 'story').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
const chars = () => [...state.items.values()].filter(x => x.kind === 'char').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
const archivesOf = sid => [...state.items.values()].filter(x => x.kind === 'arch' && x.storyId === sid).sort((a, b) => a.seq - b.seq);
const get = id => state.items.get(id);
const storyChars = s => (s.chars || []).map(get).filter(Boolean);
const personas = () => [...state.items.values()].filter(x => x.kind === 'persona')
  .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || (a.name || '').localeCompare(b.name || ''));
const defaultPersona = () => personas().find(p => p.isDefault) || null;
function personaOf(s) {
  if (!s || s.personaId === 'custom') return null;
  if (s.personaId) return get(s.personaId) || null;
  return s.userName ? null : defaultPersona();
}
const youName = s => { const p = personaOf(s); return p ? p.name : (s && s.userName) || ''; };
const youAbout = s => { const p = personaOf(s); return p ? [p.gender && 'Gender: ' + p.gender, p.description].filter(Boolean).join('. ') : (s && s.you) || ''; };
const TILE = ['#2E8B6E', '#4A4FCB', '#B4532A', '#8A3FA0', '#2F6FA8'];
const tile = (name, cls, color) => { const n = String(name || '?'); let x = 0; for (const ch of n) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return h('span', { class: 'tile' + (cls ? ' ' + cls : ''), style: `background:${color || TILE[x % TILE.length]}`, 'aria-hidden': 'true' }, n.trim().charAt(0).toUpperCase() || '?'); };
const YOU_COLOR = '#2E8B6E';
const subst = (t, s) => String(t || '').replace(/\{\{user\}\}/gi, youName(s) || 'you')
  .replace(/\{\{char\}\}/gi, (s && storyChars(s)[0]?.name) || 'they');

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; t.style.animation = 'none'; void t.offsetHeight; t.style.animation = ''; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 4200); }

/* ---------- storage ---------- */
const saveErr = e => toast(e && e.code === 'quota_exceeded' ? 'Storage is full. Delete an old story to make room.' : 'Could not save. Check your connection.');
function queue(id, fn) { const p = (writeQ[id] || Promise.resolve()).then(fn); writeQ[id] = p.catch(() => {}); return p.catch(saveErr); }
function save(id, patch) { const cur = get(id); if (cur) state.items.set(id, { ...cur, ...patch }); return queue(id, () => col.doc(id).update(patch)); }
function create(id, data) { state.items.set(id, { id, ...data }); return queue(id, () => col.doc(id).set(data)); }
function remove(id) { state.items.delete(id); return col.doc(id).delete().catch(() => toast('Could not delete. Try again.')); }

/* ---------- memory model ---------- */
function mem(s) {
  const m = s.memory || {};
  return {
    summary: m.summary || '',
    chapters: Array.isArray(m.chapters) ? m.chapters.filter(c => c && (c.title || c.text)).map(c => ({ title: String(c.title || ''), text: String(c.text || '') })) : [],
    relationships: Array.isArray(m.relationships) ? m.relationships.filter(r => r && r.name).map(r => ({ name: String(r.name), status: String(r.status || '') })) : [],
    people: strArr(m.people || m.facts, LIM.people), world: strArr(m.world, LIM.world), threads: strArr(m.threads, LIM.threads), revealed: strArr(m.revealed, LIM.revealed), invented: strArr(m.invented, LIM.invented), growth: strArr(m.growth, LIM.growth)
  };
}

/* ---------- fitting into small models ----------
   Local models can only see a few thousand tokens at once (LM Studio's "context length").
   When that limit is set, every prompt is measured and trimmed to fit, the character sheets are
   condensed once, and the saved memory is kept to a size the model can rewrite in one go. */
const tok = t => Math.ceil(String(t || '').length / 3.2);   // rough token count, on the safe side
const budget = () => (sample && typeof sample.budget === 'function' ? sample.budget() : 0);
const hashStr = t => { let x = 0; for (const ch of String(t)) x = (x * 31 + ch.charCodeAt(0)) | 0; return String(x); };
const maxWordsOf = s => { const c = lenCfg(s); return c.mode === 'max' ? c.maxWords : RANGES[c.ri][1]; };
const replyTokens = s => Math.round(maxWordsOf(s) * 1.7) + 200;
const MEM_BASE = { chapters: 8, people: 12, world: 12, invented: 15, threads: 8, revealed: 10, growth: 6 }; // for 8k models
function memCaps() {
  const B = budget(); if (!B) return null;
  const f = Math.max(0.5, B / 8192); const out = {};
  for (const k in MEM_BASE) out[k] = Math.min(LIM[k], Math.max(3, Math.round(MEM_BASE[k] * f)));
  return out;
}
function capMem(m, caps) {
  if (!caps) return m;
  const last = (a, n) => a.slice(Math.max(0, a.length - n));
  return { ...m, chapters: last(m.chapters, caps.chapters), people: last(m.people, caps.people), world: last(m.world, caps.world),
    invented: last(m.invented, caps.invented), threads: last(m.threads, caps.threads), revealed: last(m.revealed, caps.revealed), growth: last(m.growth, caps.growth) };
}
const isLong = c => budget() && tok(c.persona) > budget() * 0.18;
const personaFor = c => (isLong(c) && c.shortPersona && c.shortFor === hashStr(c.persona || '')) ? c.shortPersona : (c.persona || '');
async function ensureShort(s) {
  const B = budget(); if (!B) return;
  for (const c of storyChars(s)) {
    if (!isLong(c)) continue;
    const h = hashStr(c.persona || '');
    if (c.shortFor === h && c.shortPersona) continue;
    const words = Math.round(B * 0.15 * 0.75);
    try {
      const r = await sample(`Condense this character description for a storyteller AI that has very little room. Keep, in this order: who they are (name, age, look, personality); how they talk and move; the important people around them, one line each; every hidden secret, one short line each; how to play them. Keep {{user}} exactly as written. No intro, no headings longer than two words. At most ${words} words.

${c.persona}`, { cache: false, maxTokens: Math.round(words * 1.6) + 100 });
      const t = (r.text || '').trim();
      if (t) await save(c.id, { shortPersona: t, shortFor: h });
    } catch (_) {}
  }
}

/* Recall: search everything older than the recent window for moments that match what is happening now. */
const STOP = new Set(("the and that with this from have were they them their what when your you she her his him for was are but not just like then than into about there would could been said says out too all its it's i'm you're don't didn't she'd he'd that's what's it’s i’m you’re don’t didn’t she’d that’s what’s one back over only even still again some more very really know think going get got make made want look looked looks did does doing").split(' '));
const toks = t => (String(t).toLowerCase().match(/[a-z0-9'’]{3,}/g) || []).filter(w => !STOP.has(w));
function recall(s) {
  const msgs = s.messages || [];
  const older = msgs.slice(0, Math.max(0, msgs.length - (budget() ? 12 : CONTEXT_TURNS)));
  const pool = [...archivesOf(s.id).flatMap(a => a.messages || []), ...older].filter(m => m && m.text);
  if (pool.length < 3) return [];
  const qt = new Set(toks(subst(msgs.slice(-2).map(m => m.text).join(' '), s)));
  if (!qt.size) return [];
  const df = new Map();
  const sets = pool.map(m => { const ts = new Set(toks(subst(m.text, s))); ts.forEach(w => df.set(w, (df.get(w) || 0) + 1)); return ts; });
  const N = pool.length;
  return pool.map((m, i) => { let sc = 0; for (const w of qt) if (sets[i].has(w)) sc += Math.log(1 + N / df.get(w)); return { m, i, sc }; })
    .filter(x => x.sc > 3).sort((a, b) => b.sc - a.sc).slice(0, RECALL_COUNT).sort((a, b) => a.i - b.i).map(x => x.m);
}

/* ---------- prompts ---------- */
function memoryBlock(s) {
  const m = capMem(mem(s), memCaps()); const out = [];
  if (m.chapters.length) out.push('Earlier chapters:\n' + m.chapters.map((c, i) => `${i + 1}. ${c.title}: ${c.text}`).join('\n'));
  out.push('Current arc: ' + (m.summary || '(the story has just begun)'));
  if (m.relationships.length) out.push('Where relationships stand now:\n' + m.relationships.map(r => `- ${r.name}: ${r.status}`).join('\n'));
  if (m.people.length) out.push('Facts about the characters:\n' + m.people.map(f => '- ' + f).join('\n'));
  if (m.world.length) out.push('Places, objects and past events:\n' + m.world.map(f => '- ' + f).join('\n'));
  if (m.invented.length) out.push('Established about the characters\' pasts during this story (true now; keep consistent):\n' + m.invented.map(f => '- ' + f).join('\n'));
  if (m.growth.length) out.push('How the characters have changed during this story:\n' + m.growth.map(f => '- ' + f).join('\n'));
  if (m.revealed.length) out.push('Secrets that have already come out (the characters know these now; build on them instead of revealing them again):\n' + m.revealed.map(f => '- ' + f).join('\n'));
  if (m.threads.length) out.push('Open threads (unresolved; keep them alive and pay them off over time):\n' + m.threads.map(f => '- ' + f).join('\n'));
  return out.join('\n\n');
}
const EVO_FLAVORS = {
  'a hobby': ['thrifting old film cameras', 'competitive Mario Kart', 'baking at 3am when she can\'t sleep', 'keeping a beat-up journal she never lets anyone read', 'collecting vinyl', 'figure skating as a kid and still missing it', 'running an anonymous meme account', 'learning guitar, badly', 'night drives with no destination', 'roller skating'],
  'family': ['very close to an older brother who is overprotective', 'only child of a single mom she calls every Sunday', 'a little sister she adores and spoils', 'parents who run a small restaurant she grew up working in', 'raised partly by her grandma, whose sayings she quotes', 'a huge, loud family that never stops group-texting'],
  'a sore spot': ['being forgotten or left out', 'deep water', 'hospitals', 'being seen crying', 'disappointing her dad', 'thunderstorms', 'people leaving without saying goodbye'],
  'a quirk': ['hums when she is nervous', 'never finishes a coffee', 'collects sugar packets from every cafe', 'names inanimate objects', 'talks to her plants', 'keeps everyone\'s birthday in a notebook', 'cannot sit still during movies'],
  'a guilty pleasure': ['reality dating shows', 'cheesy romance novels', 'gas station snacks', 'old Disney Channel movies', 'anime she pretends not to watch', 'astrology she claims not to believe in']
};
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const makeEvoSeed = () => Object.entries(EVO_FLAVORS).map(([k, v]) => `${k}: ${pickOne(v)}`).join('; ');
const evolvedOf = s => storyChars(s).filter(c => c.evolved);
function evolvedBlock(s, you) {
  const ev = evolvedOf(s); if (!ev.length) return '';
  const names = ev.map(c => c.name).join(', ');
  return `EVOLVED CHARACTERS (${names}): their description is only a starting core, not a fixed sheet. This story has its own version of them.
- This version starts with ${s.evoSeed || 'whatever details you choose'}. Build on these unless the core description says otherwise.
- Invent their past as you go. They bring up events, memories, people, places, habits and stories that supposedly happened before the story or between scenes ("Remember when we..."), including shared memories with ${you} that were never shown. Make them specific and vivid, and avoid the most obvious choices.
- Anything they claim becomes true for this story. Check STORY MEMORY first and never contradict what has already been established.
- Let them grow. Their opinions, confidence, habits and feelings shift with what happens, and they pick up new interests, phrases and running jokes along the way.
- Every few replies, reveal something new from their past or a new side of them.
- If ${you} questions a memory they claimed, they can insist, laugh it off, or admit they made it up, whichever fits them.`;
}
function rules(s) {
  const cs = storyChars(s);
  const you = youName(s) || 'the user';
  const recalled = recall(s);
  return subst([
    'You are the storyteller in an ongoing interactive story, written together with the user. You voice the narrator and every character listed below. The user writes as their own character.',
    cs.length ? 'CHARACTERS YOU PLAY:\n' + cs.map(c => `- ${c.name}: ${personaFor(c)}`).join('\n') : 'You play the narrator and any characters the scene needs.',
    `THE USER'S CHARACTER (their persona; respect every detail of it, including gender and pronouns): ${you}. ${youAbout(s)}`,
    evolvedBlock(s, you),
    s.scenario ? 'SCENARIO: ' + s.scenario : '',
    s.pinned ? 'ALWAYS TRUE (pinned by the user):\n' + s.pinned : '',
    (s.pinnedMsgs || []).length ? 'PINNED MOMENTS (the user marked these as important; never forget or contradict them):\n' +
      s.pinnedMsgs.map(p => '- ' + p.text.slice(0, 900)).join('\n---\n') : '',
    'STORY MEMORY. All of this already happened. Stay consistent with it, refer back to it naturally, and let characters remember it:\n\n' + memoryBlock(s),
    recalled.length ? 'RECALLED MOMENTS (exact excerpts from earlier in the story that relate to what is happening now; use details from them if they fit):\n' +
      recalled.slice(0, budget() ? 3 : 99).map(m => (m.role === 'user' ? `[${you}] ` : '[story] ') + m.text.slice(0, budget() ? 350 : 700)).join('\n---\n') : '',
    budget() ? compactRules(s, you) : `HOW TO REPLY:
- Length: ${lenOf(s).prompt}. Use short paragraphs.
- Style: present tense, second person. In narration, call ${you} "you" (She grabs your hand. She pokes your chest.). Narration is plain prose with no asterisks. Everything a character says goes in double quotes. Use *single asterisks* only to stress one word, like *terrified* or *album*.
- Rhythm: short paragraphs of 1 to 4 sentences. Narration carries as much as dialogue: precise small physical details (where hands are, what a thumb or a pinky does, a jaw tightening, ears going pink), charged pauses, and a touch of setting (a bell over a door, rain on a window). Use a fragment now and then for rhythm. Show feelings through specific actions instead of naming them.
- Voice: lean into the character's personality: dry banter and teasing that turns briefly sincere, then back.
- Never put speaker labels like "Val:" in front of lines, and never put narration in asterisks or italics, even if earlier messages in the story did.
- Side characters who are in the scene (friends, classmates, strangers) can jump in with their own lines. Make clear who is talking through narration (Chloe snorts. Mia coughs loudly.).
- The characters described above are the main cast, not the whole world. When the story calls for it, bring in new people naturally (classmates, roommates, rivals, family, exes, people already mentioned like Ethan or Marcus) and give them names and distinct personalities. Once someone has appeared, keep them consistent and let them come back later.
- Pacing: move fast. Every reply must change something: the plot, the relationship, the place, the time, or what someone knows. Don't spend more than one sentence on staring, hesitating, blushing or breathing, and never repeat a beat from an earlier reply. Jump over slow stretches with time skips (Later that night... Two days later... By the time class ends...). Scenes should not drag; when a moment has landed, cut to what comes next.
- Events: characters actively make plans and bring things up on their own. They mention and invite ${you} to upcoming things (parties, game nights, a concert, a trip off campus, a birthday, a sorority formal, exam week, a road trip, a family visit, a class project), set dates for them, and then those events actually happen later in the story. Roughly every few replies, start or advance something: a plan, an invitation, a text with news, a rival or ex showing up, gossip, a schedule change, or a problem to deal with. Track upcoming events so they pay off.
- Variety: never repeat a joke, nickname, running gag or callback that already appeared in the recent messages. Rotate through different shared memories and invent fresh ones.
- Vary how replies end. Most replies should NOT end with a question. End on an action, a reaction, a statement, a tease, an awkward silence, someone walking off, or right in the middle of a moment, anything that leaves room for ${you} to respond without asking them to. Only end with a question when the character would really ask one, at most about once every four or five replies, and never twice in a row.
- ${you}'s messages arrive split into lines. "says out loud" lines are spoken, and everyone nearby hears them. "[action/thought]" lines are ${you}'s actions, private thoughts and feelings, or directions for the scene. Other characters can notice visible actions and body language (blushing, laughing, moving), but they can NEVER hear, know, repeat, quote or react to ${you}'s thoughts or the words inside them. If a thought names something (like "indirect kiss"), no character may say it unless they come up with it on their own. When an [action/thought] line describes what other characters do or what happens next, treat it as ${you}'s direction and follow it.
- Never write ${you}'s words, thoughts or choices.
- Keep each character's voice, personality and history consistent with the memory above.`,
    'The story continues now from the messages that follow.'
  ].filter(Boolean).join('\n\n'), s);
}
function compactRules(s, you) {
  return `HOW TO REPLY:
- Length: ${lenOf(s).prompt}. Short paragraphs of 1 to 4 sentences.
- Present tense, second person: call ${you} "you". Narration is plain prose with no asterisks; dialogue goes in double quotes. No speaker labels like "Val:".
- Small precise physical details, charged pauses, a touch of setting. Show feelings through actions.
- Move fast. Every reply changes something (plot, place, time, relationship, what someone knows). Use time skips. Never repeat a beat, joke or callback from recent messages.
- Characters make plans, invite ${you} to things, text news, bring in other people; those events happen later.
- Most replies do NOT end with a question; end on an action, a line, or mid-moment.
- ${you}'s lines marked "says out loud" are heard by everyone nearby. "[action/thought]" lines are actions, private thoughts or scene directions: others may notice visible actions but can never hear or know ${you}'s thoughts. Follow scene directions.
- Never write ${you}'s words, thoughts or choices. Stay consistent with STORY MEMORY.`;
}
function buildInput(s) {
  const B = budget();
  const sys = rules(s);
  const turns = [{ role: 'user', content: sys }];
  const you = youName(s) || 'The player';
  let conv = (s.messages || []).slice(-CONTEXT_TURNS).filter(m => m.text && m.text.trim())
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.role === 'user' ? labelUser(subst(m.text, s), you) : subst(m.text, s) }));
  if (B) {
    // Keep as many recent messages as fit, newest first.
    let room = B - tok(sys) - replyTokens(s) - 250;
    const kept = [];
    for (let i = conv.length - 1; i >= 0; i--) {
      const t = tok(conv[i].content) + 6;
      if (t > room && kept.length >= 2) break;
      room -= t; kept.unshift(conv[i]);
    }
    conv = kept;
  }
  turns.push(...conv);
  if (turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: '(Continue the story from here.)' });
  return turns;
}
function errorCopy(e) {
  switch (e && e.code) {
    case 'not_granted': return 'Claude access was declined for this page. Reload the page to allow it.';
    case 'rate_limited': return 'You have reached a usage limit. Try again a bit later.';
    case 'refused': return 'Claude declined to write that. Try rewording your message.';
    case 'prompt_too_large': return 'This story is too long to send. Trim the memory or pinned notes.';
    case 'session_expired': return 'Your session expired. Sign in to claude.ai again.';
    case 'sampling_disabled': return 'Claude is not available for this account.';
    case 'no_provider': return 'Add a model and API key in Settings first.';
    case 'bad_key': return 'The API key was rejected. Check it in Settings.';
    case 'network': return 'Could not reach the model. Check your connection, or that your computer is on if you run it locally.';
    case 'bad_model': return 'The model name was not found. Check it in Settings.';
    case 'server': return e.message ? 'The model returned an error: ' + e.message : 'The model returned an error. Tap Retry.';
    default: return 'Something went wrong. Tap Retry to try again.';
  }
}

/* ---------- generation ---------- */
async function generate(id) {
  if (!sample || state.streaming) return;
  let s = get(id); if (!s) return;
  if (evolvedOf(s).length && !s.evoSeed) { await save(id, { evoSeed: makeEvoSeed() }); s = get(id); }
  ctl = new AbortController();
  state.streaming = { id, text: '' }; paintStory();
  if (budget()) { await ensureShort(s); s = get(id) || s; }
  let text = '', failed = null;
  try {
    const r = await sample(buildInput(s), { cache: false, signal: ctl.signal, ...(budget() ? { maxTokens: replyTokens(s) } : {}),
      onText: u => { if (state.streaming) { state.streaming.text = u.text; paintStream(); } } });
    text = r.text;
  } catch (e) { failed = e; text = e.code === 'refused' ? '' : (e.text || ''); }
  state.streaming = null;
  const now = get(id); if (!now) return paintStory();
  if (text.trim()) {
    const since = (now.sinceMemory || 0) + 1;
    const nid = rid(); if (state.seen) state.seen.add(nid); // already on screen as the streamed bubble
    await save(id, { messages: [...(now.messages || []), { id: nid, role: 'ai', text, ts: Date.now() }], sinceMemory: since, updatedAt: Date.now() });
    await maybeArchive(id);
    paintStory();
    if (since >= MEMORY_EVERY && !failed) updateMemory(id, false);
  } else paintStory();
  if (failed && failed.code !== 'cancelled') toast(errorCopy(failed));
}
async function maybeArchive(id) {
  const s = get(id); const msgs = s.messages || [];
  if (msgs.length < ARCHIVE_AT) return;
  const seq = (s.archiveSeq || 0) + 1;
  await create(`arch_${id}_${seq}`, { kind: 'arch', storyId: id, seq, messages: msgs.slice(0, ARCHIVE_CHUNK), createdAt: Date.now() });
  await save(id, { messages: msgs.slice(ARCHIVE_CHUNK), archiveSeq: seq, archivedCount: (s.archivedCount || 0) + ARCHIVE_CHUNK });
}
async function send() {
  const box = $('#say'); const id = state.view.id; const s = get(id);
  if (!s || state.streaming) return;
  const text = box.value.trim();
  if (text) {
    box.value = ''; autosize(box);
    state.forceBottom = true;
    await save(id, { messages: [...(s.messages || []), { id: rid(), role: 'user', text, ts: Date.now() }], sinceMemory: (s.sinceMemory || 0) + 1, updatedAt: Date.now() });
  }
  state.openMsg = null;
  generate(id);
}
async function retry() {
  const id = state.view.id; const s = get(id); if (!s || state.streaming) return;
  const msgs = [...(s.messages || [])];
  while (msgs.length && msgs[msgs.length - 1].role === 'ai') msgs.pop();
  await save(id, { messages: msgs });
  generate(id);
}
const STR_LIST = { type: 'array', items: { type: 'string' } };
const MEM_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['summary', 'chapters', 'relationships', 'people', 'world', 'invented', 'growth', 'revealed', 'threads'],
  properties: {
    summary: { type: 'string' },
    chapters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: { type: 'string' }, text: { type: 'string' } } } },
    relationships: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'status'], properties: { name: { type: 'string' }, status: { type: 'string' } } } },
    people: STR_LIST, world: STR_LIST, invented: STR_LIST, growth: STR_LIST, revealed: STR_LIST, threads: STR_LIST
  } };
async function updateMemory(id, manual, rewound) {
  if (!sample || state.memBusy.has(id)) return;
  const s = get(id); if (!s) return;
  const msgs = s.messages || [];
  const take = (manual || rewound) ? Math.min(msgs.length, LIM.take) : Math.min(msgs.length, (s.sinceMemory || 0) + 6, LIM.take);
  if (!take) { if (manual) toast('Nothing to remember yet.'); return; }
  const you = youName(s) || 'the user';
  const B = budget(), caps = memCaps(), L = caps || LIM;
  if (B) await ensureShort(s);
  const parts = msgs.slice(-take).map(m => m.role === 'user' ? labelUser(subst(m.text, s), you) : '[story] ' + subst(m.text, s));
  const outTok = B ? Math.min(2400, Math.round(B * 0.3)) : 4096;
  const template = subst(`You are the memory keeper for a long interactive story. A storyteller AI will read your memory before writing every reply, and it cannot see anything older than the last ${CONTEXT_TURNS} messages. Your memory is how it remembers everything else, so be precise and specific.

Characters played by the storyteller: ${storyChars(s).map(c => c.name).join(', ') || 'narrator'}.
Character descriptions, including their hidden secrets:
${storyChars(s).map(c => `[${c.name}] ${personaFor(get(c.id) || c)}`).join('\n\n') || '(none)'}
The user plays: ${you}. ${youAbout(s)}
Scenario: ${s.scenario || '(none)'}
Pinned by the user: ${s.pinned || '(none)'}

CURRENT MEMORY (JSON):
${JSON.stringify(capMem(mem(s), caps))}

NEWEST PART OF THE STORY (some of it may already be in memory):
@@TRANSCRIPT@@

${rewound ? 'IMPORTANT: this story was rewound. The transcript above ends at the true present moment. Anything in the current memory that happens after the end of the transcript did not happen: remove it, and roll relationships and threads back to how they stood at the end of the transcript.\n\n' : ''}Update the memory with what happened. Rules:
- "summary": the current story arc in past tense, 120 to 250 words. Concrete: who did what, where, and why it matters.
- "chapters": finished arcs, oldest first, each {"title": "3-6 words", "text": "2-3 sentences"}. Copy existing chapters unchanged. When the current arc has clearly wrapped up or the summary is getting long, close it as a new chapter and start a fresh summary. At most ${L.chapters}.
- "relationships": one entry per important character, {"name": "...", "status": "how they feel about ${you} and each other right now, what changed recently, any tension, 1-2 sentences"}.
- "people": durable facts about characters, including any new side characters who have appeared (name, who they are, personality, how they relate to everyone): appearance, habits, history, likes, things they said that matter, secrets revealed. Short, specific lines.
- "world": places, objects, gifts, dates, and key past events with when they happened.
- "invented": every detail about a character's past that came up in the story but was not in their description: memories they mentioned, family, old friends or exes, childhood stories, past events, habits, shared memories with the user's character that were never shown. One specific line each. Keep all earlier entries.
- "growth": how characters have changed during the story (new opinions, new habits, more or less confident, feelings shifting), one line each. Update lines as they keep changing.
- "revealed": every hidden secret from the character descriptions that has now come out in the story, in a short line saying what was revealed and how (for example, she showed him the photo album). Keep all earlier entries.
- "threads": unresolved things, including every upcoming plan or event with when it is supposed to happen: rumors, promises, plans, secrets not yet revealed, questions left hanging, upcoming events.
- Keep everything that is still true. Fix anything that changed. Remove things that are resolved or trivial. Never invent events.
- Only record what actually happened in the story transcript. Never copy notes, example behaviors or lines from the character descriptions into memory; those already reach the storyteller separately.
- Use names, not pronouns. At most: people ${L.people}, world ${L.world}, invented ${L.invented}, revealed ${L.revealed}, growth ${L.growth}, threads ${L.threads} lines.${B ? ' Keep every line under 20 words. When a list is full, merge or drop the least important lines.' : ''}

Reply with only the JSON object:
{"summary": "", "chapters": [], "relationships": [], "people": [], "world": [], "invented": [], "growth": [], "revealed": [], "threads": []}`, s);
  // Fit as much of the newest story as the model can take.
  let kept = parts;
  if (B) {
    let room = B - tok(template) - outTok - 200; kept = [];
    for (let i = parts.length - 1; i >= 0; i--) { const t = tok(parts[i]) + 2; if (t > room && kept.length) break; room -= t; kept.unshift(parts[i]); }
  }
  const prompt = template.replace('@@TRANSCRIPT@@', () => kept.join('\n\n'));
  state.memBusy.add(id); paintBar();
  try {
    const out = await sample.json(prompt, { cache: false, maxTokens: outTok, schema: MEM_SCHEMA });
    const next = capMem(mem({ memory: out || {} }), caps);
    if (next.summary || next.people.length || next.relationships.length) {
      const cur = mem(get(id) || s);
      if (!next.chapters.length && cur.chapters.length) next.chapters = cur.chapters; // never lose old chapters
      await save(id, { memory: next, sinceMemory: 0, memoryAt: Date.now() });
      if (manual) toast('Memory updated.');
      if (state.sheetFor === id) memorySheet(id);
    } else if (manual) toast('Memory update came back empty. Try again.');
  } catch (e) {
    if (e.code !== 'cancelled') {
      if (manual) toast(e.code === 'invalid_json' ? 'Memory update failed. Try again.' : errorCopy(e));
      else toast('Memory update didn\'t work this time. It will try again after your next message.');
    }
  }
  state.memBusy.delete(id); paintBar();
}
