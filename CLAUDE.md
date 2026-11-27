# DreamScapes (repo: ajthebotheroffinn-debug/afterglow)

A personal Swerve-style AI story / roleplay app for iPhone, built around the best possible long-term memory.
The owner (AJ) plays stories with characters like Valerie, mostly using local models in LM Studio on a Windows PC.

## Working rules (from the owner — follow them)
- **Never push to GitHub unless the owner says so** ("push it", "push out the update"). Make changes, test them, commit locally,
  summarize what changed, then wait. Pushing triggers builds and the owner wants to review first.
- Bump `APP_VERSION` in `src/core.js` for every update: MAJOR.MINOR.PATCH — big overhaul = first number,
  new features = middle, small fixes/tweaks = last. It shows at the top left of Settings.
- **API keys never go into backups, debug reports or logs.**
- Tell the owner plainly whether an update needs a **reinstall** (anything under `ios/`) or just **closing and reopening
  the app** (anything under `src/`).
- The owner isn't a programmer: explain results in plain words, short.
- When diagnosing story/memory problems, ask for a **debug report** (Settings › Data › Debug log › Share debug report).
  It has every prompt sent to the model, what came back, timings, events (rewinds, deletes, retries), app errors,
  the story's memory and full transcript, plus the owner's "what went wrong" note.

## How it ships
- `src/` is the app (plain HTML/CSS/JS). `tools/build.py` combines it into `web/index.html`.
- GitHub Pages serves the web app at https://ajthebotheroffinn-debug.github.io/afterglow/ — the iPhone app loads it from
  there on launch, so web changes reach the phone by just reopening the app. Workflow: `.github/workflows/pages.yml`
  (runs on changes to `src/**`, `tools/build.py`).
- `ios/` is a small native shell (Swift, XcodeGen `ios/project.yml`). `.github/workflows/build-ipa.yml` builds an unsigned IPA
  on `macos-15` for every push touching `ios/**` and publishes it as a release. Install link (always the newest):
  https://github.com/ajthebotheroffinn-debug/afterglow/releases/latest/download/Afterglow.ipa
  The owner sideloads it with SideStore / LiveContainer, installing **over** the old app (keeps data). Export a backup first.
- The build step pipes `xcodebuild | tail`, so a **Swift compile error can still "succeed" and publish an empty ~50 KB IPA**.
  After any iOS push, download the release and check the IPA contains `Payload/Afterglow.app/Afterglow` (the binary)
  — a good IPA is ~450 KB. (Fixing the workflow to fail properly, e.g. `set -o pipefail`, would be a good improvement.)
- The product/bundle/IPA name stays `Afterglow` on purpose (keeps the download link and the installed app's data);
  only the display name is DreamScapes. Backups still write `"app":"afterglow"` for compatibility.

## Code map
- `src/app.html` — template; `//@include` pulls in the files below, in this order:
  `core.js` (helpers, APP_VERSION, NATIVE_SCROLL / NATIVE_COMPOSER flags) → `characters.js` (built-in Valerie presets) →
  `engine.js` (state, prompts, memory, recall, consistency check, generate) → `views.js` (rendering, native message-box
  bridge, word fade-in, reply timer) → `sheets.js` (sheets: story settings incl. action/speech sliders, memory, personas) →
  `debug.js` (debug log; wraps rewindTo/branch/delMsg/retry/updateMemory to log events) → `main.js` (settings pages,
  profiles, paste-a-profile, model wrapper `streamDrafts` → `withUserCtl` / `anchorScene`, boot).
- `src/platform.js` — phone platform layer: storage (native files or IndexedDB), model profiles (`tk-model-config`),
  networking (native via the Swift `NetClient`, or fetch), one request at a time (`serial`), embeddings.
- `ios/Sources/WebViewController.swift` — WKWebView host, boot script (`TK_BOOT`, `TK_CONFIG`, `TK_NATIVE_SCROLL`,
  `TK_NATIVE_COMPOSER`), message handler `tk`, native networking, daily backups trigger, native message box as the
  view controller's `inputAccessoryView` (so the keyboard drag starts at the top of the box, like Swerve/Messages).
- `ios/Sources/InputBar.swift` — the native message box (grows with text up to ~6 lines).
- `ios/Sources/Store.swift` — JSON files in Documents/Data, daily backups in Documents/Backups (no API keys).

## Memory system (the core feature)
- Every reply gets: character + persona, long-term memory (summary, relationships, people, world, threads, revealed,
  invented, growth, chapters), the last 40 messages (fit to the model's context size), and **recall**: older moments and
  set-aside facts matching the newest message, attached next to the newest message (keeps LM Studio's prompt cache warm).
- Memory updates every 8 messages and after rewinds (`updateMemory(id, manual, rewound)`), JSON schema forced for local models.
- Experimental memory mode (per profile): recall scales with context, searches set-aside facts, optional embeddings
  (nomic `search_query:` / `search_document:` prefixes, cached in IndexedDB), optional consistency check that edits the
  reply against the story before it's final (draft streams dimmed meanwhile).
- Known issue being watched: after a rewind, a reply jumped back to an older scene (classroom instead of the friend group).
  Likely cause: recalled old moments were labelled "relate to what is happening now". Fixed in 1.10.0 by `anchorScene`
  in main.js (labels them as the past + a NOW line). If it recurs, get a debug report.
- Story settings › "Your actions" / "Your speech" sliders (None, A little, Normal, A lot; per story; Normal adds nothing)
  control how much the model writes for the player's character (`userCtlRules` in main.js).

## Owner's setup
- Windows PC, 8 GB VRAM, LM Studio server on port **1235**, phone reaches it through ngrok:
  `ngrok http 1235 --url=caddy-dwelling-gurgling.ngrok-free.dev` → app server address
  `https://caddy-dwelling-gurgling.ngrok-free.dev/v1`.
- Main model `rocinante-12b-v1.1` (32768 context, GPU offload 30, Flash Attention on, K/V cache Q8_0, max concurrent 1).
  Also `l3-8b-stheno-v3.2`; embeddings `text-embedding-nomic-embed-text-v1.5`.
- Profile paste format (Settings › All profiles › Paste from clipboard), one `Label: value` per line:
  Profile name, Provider, Server address, API key, Model name, Context size, Experimental memory mode, Consistency check, Embedding model.

## Testing
- `python3 tools/build.py` then run tests with the fake model server:
  `PYTHONHASHSEED=1 python3 tools/fake_server.py &` (serves `web/` and a fake OpenAI/LM Studio API on 127.0.0.1:8765),
  then e.g. `python3 tools/test_web.py`. Needs Python Playwright + Chromium (`pip install playwright && playwright install chromium`).
- Tests: test_web, test_native (fake native bridge), test_nativebar, test_docscroll, test_profiles, test_paste, test_budget,
  test_overflow, test_xmem, test_xcheck, test_timer, test_userctl, test_anchor, test_debug, test_backup_models, test_val20.
  Restart the fake server if tests start failing with connection errors. Each prints ALL PASSED or the failures.
- Native Swift can't be compiled except on a Mac / in the GitHub Actions build; keep Swift changes conservative and
  check the built IPA as above.
