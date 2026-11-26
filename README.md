# Afterglow

A personal story-chat app with long-term memory, characters, personas and Evolved characters.

## Install
1. Download the newest IPA: **Releases → latest → Afterglow.ipa**
   (direct link: `https://github.com/ajthebotheroffinn-debug/afterglow/releases/latest/download/Afterglow.ipa`).
2. Open it with SideStore or LiveContainer.
3. In the app, tap **Settings**, pick a model, paste your API key, tap **Test connection**, then **Save**.

## Moving your stories from the Claude version
In the Claude version tap **Export for app**, then in this app go to **Settings → Import backup**.

## Updates
The app loads its screens from GitHub Pages, so changes pushed to `src/` show up the next time you open the app.
A new IPA is only needed when something in `ios/` changes.

## Your data
Everything is stored on the phone (Files › On My iPhone › Afterglow › Data), with a daily backup in the Backups folder
(newest 14 kept). Your API key is stored only on the phone.

## Layout
- `src/app.html` – the app (shared with the Claude version)
- `src/platform.js` – on-device storage, model connections (Claude, Qwen/OpenRouter/Ollama/LM Studio), backups
- `tools/build.py` – builds `web/index.html`
- `tools/make_icon.py` – draws the app icon during the build
- `ios/` – the native shell (WKWebView), built by `.github/workflows/build-ipa.yml`
