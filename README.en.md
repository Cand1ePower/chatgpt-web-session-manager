# ChatGPT Card Manager

Current version: **v1.17.0** · [中文版 README](README.md)

A Chrome / Edge Manifest V3 extension that runs directly on `chatgpt.com` and turns ChatGPT history into browsable, searchable, selectable cards.

## Highlights

- Load conversation cards in batches while list metadata and message details remain independent.
- Read details on demand and persist them in an IndexedDB cache to reduce duplicate requests and 429 risk; idle hydration runs at a deliberately low rate.
- Load `10 / 30 / 50 / 100 / all` uncached conversation details.
- Slow, normal, and fast detail-loading modes; fast mode explains the official rate-limit risk first.
- 429 circuit breaker, cooldown messaging, and shared rate-limit state across tabs.
- Markdown rendering, image thumbnails, and an in-page image lightbox.
- Real-card FLIP expand / collapse animation; hover expansion on precise pointers with click-to-expand fallback on touch devices.
- Single and multi-select, batch archive, and batch delete with an anchored in-page confirmation card.
- A confirmed server-side deletion dissolves the card into powder before removing it.
- Open the original ChatGPT conversation in a new browser tab.
- Loaded / unloaded visual states, narrow-screen layout, keyboard controls, focus trapping, and ARIA state.
- Selected cards show a clockwise flowing rainbow rim; long lists use lightweight DOM, chunked rendering, `content-visibility`, and debounced search.

## v1.17: Animation, performance, and interaction pass

- Unselected and off-screen cards no longer create rainbow animation layers; selected rims pause during expansion and FLIP transitions.
- Detail visual updates are frozen during expand / collapse. Sixteen messages render first, the rest in chunks of twelve, and media requests wait until chunk rendering completes.
- Collapse timing follows the remaining geometric distance; selected-card target size, zero-size matrix edges, and resize races are handled explicitly.
- The full-screen expand veil blur and full-card loading shadow animation were removed to reduce paint pressure during motion.
- Only the active `current_node → parent` branch is parsed, with a parser-cache schema so stale mixed-branch caches no longer hit.
- Batch list hydration renders once after completion; select-all updates existing cards in place, and date formatters / digest results are reused.
- Fixed queue recovery after reopening the panel, cooldown-banner cleanup, and late async media writes after a card collapses.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions/` in Chrome or Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this repository directory.
5. Refresh `https://chatgpt.com/`.

For an update, replace the old directory, click **Reload** in the extensions page, and refresh ChatGPT.

## Safety and scope

The extension depends on the private conversation endpoints currently used by the ChatGPT web application, not on a stable public OpenAI API. Changes to web endpoints, authentication, or rate limiting may require a corresponding update.

Message details are cached by the content script in IndexedDB owned by the `chatgpt.com` site origin. They are not uploaded to this repository or another service. Clearing ChatGPT site data also clears this cache. Archive and delete are real server-side actions; review the confirmation UI before continuing.

## Local demo and verification

The repository includes a fully isolated demo fixture that does not require a ChatGPT login:

- `demo/playwright/mock-server.mjs` returns synthetic list and detail responses only.
- `demo/test-fixtures/conversations.json` contains fictional demo content.
- `output/playwright/` contains Playwright-generated screenshots.
- `demo/hyperframes/` contains the HyperFrames HTML composition and MP4.
- `demo/remotion/` contains the Remotion React composition and MP4.

Run the isolated page:

```powershell
node demo/playwright/mock-server.mjs
```

Then use the local Playwright CLI to open `http://127.0.0.1:4173/demo/playwright/test-page.html`. The page creates a fresh `chatdeck-cache-v1` test IndexedDB under the `127.0.0.1` origin. It does not read `.local/manual-profile` or real ChatGPT conversations.

Generated demo artifacts:

- [Playwright overview screenshot](output/playwright/demo/01-overview.png), [selection screenshot](output/playwright/demo/02-selected.png), and [expanded-detail screenshot](output/playwright/demo/03-expanded.png)
- [HyperFrames demo video](demo/hyperframes/renders/chatdeck-hyperframes-demo.mp4)
- [Remotion demo video](demo/remotion/renders/chatdeck-remotion-demo.mp4)

## Project files

- `manifest.json` — Manifest V3 configuration and version.
- `content.js` — UI, cache, request scheduling, Markdown / image previews, animation, and batch management.
- `CHANGELOG.md` — Release history from v0.1 through the current version.
- `README.md` — Default Chinese documentation shown by GitHub.
