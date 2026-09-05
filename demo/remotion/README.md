# ChatDeck Remotion demo

This composition turns the isolated Playwright screenshots into a short product-documentary video. It uses three frame-driven scenes and two transitions from `@remotion/transitions`.

The screenshots in `public/demo/` are synthetic fixtures generated from `demo/playwright/test-page.html`; no real ChatGPT account data is used.

```powershell
pnpm install
pnpm run lint
pnpm run render
pnpm run still
```

The MP4 and review still are written to `renders/`.
