# Handoff to Claude Code (for Claude to read first)

The project moved here from a Claude chat session. Everything up to **v1.10.0** is pushed to GitHub
(`ajthebotheroffinn-debug/afterglow`, branch `main`), including this file and CLAUDE.md.

The one thing not in the repo is the **test suite** (`tools/test_*.py` and `tools/fake_server.py`). The owner has it in
`dreamscapes-project.zip` (from the chat). On first setup, copy that zip's `tools/` folder into the clone, run the tests
(see CLAUDE.md › Testing), and offer to commit them so they live in the repo from then on (push only when the owner says so).

## First-time setup
1. `git clone https://github.com/ajthebotheroffinn-debug/afterglow.git` and open it.
2. Copy `tools/` from the zip into the clone (don't overwrite `tools/build.py` or `tools/make_icon.py` if they differ;
   the repo's versions are current).
3. `pip install playwright && playwright install chromium`, then `python tools/build.py`,
   start `tools/fake_server.py`, run the tests. All should print ALL PASSED.

## Latest state (v1.10.0, pushed from the chat on 2026-11-27)
- Native message box grows with the text, up to ~6 lines (`ios/Sources/InputBar.swift`). The IPA build for it should be
  checked: the release IPA must be ~450 KB and contain `Payload/Afterglow.app/Afterglow`.
- Recall fix (`anchorScene` in `src/main.js`): old recalled moments labelled as the past + a NOW line. Watching whether
  replies still jump back to an older scene after a rewind — ask the owner for a debug report if it happens.
- Story settings › "Your actions" / "Your speech" sliders (None, A little, Normal, A lot), per story.
- Settings › Data › Debug log (`src/debug.js`, `src/debug.css`).

## Ideas the owner may ask about next
- Make `.github/workflows/build-ipa.yml` fail on Swift compile errors (`set -o pipefail` before `xcodebuild … | tail`),
  so a broken build can't publish an empty IPA.
