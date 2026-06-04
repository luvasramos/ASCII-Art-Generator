# ASCII Rendering Studio

Professional browser-based ASCII image rendering studio for layered grayscale typography.

## Open The Standalone App

Open `dist/index.html` directly. No install, terminal, local server, `npm run dev`, or `npm run preview` is required for the built app.

Keep `dist/index.html` next to the `dist/assets` folder when copying or zipping the app.

## Development

The project-root `index.html` is for Vite development and references `/src/main.tsx`, which is compiled by Vite during dev.

```bash
npm install
npm run dev
```

Then open the URL Vite prints, usually `http://localhost:5173`.

## Production Build

```bash
npm run build
npm run preview
```

The final standalone app is `dist/index.html`. It is safe to copy the `dist` folder to macOS, Windows, or Linux and open `dist/index.html` directly in Chrome, Edge, Safari, or Brave, as long as `index.html` remains next to the `assets` folder.

## Direct File Opening

Open the built `dist/index.html` for no-server use.

Standalone mode avoids module workers under `file://` and automatically uses the main-thread renderer. Custom font uploads use the FontFace API with multiple loading fallbacks; if a browser refuses a custom font, the app keeps running and falls back to the configured monospace font stack. PNG and SVG exports use Blob downloads with a Safari-compatible open-in-new-tab fallback.

When packaging the project, include source files, `package.json`, and `package-lock.json`. Do not include `node_modules`; regenerate it with `npm install`.

## Core Features

- JPG, PNG, and WEBP upload, drag-and-drop, and paste input.
- Layered ASCII rendering with a background block and foreground glyph color for every character cell.
- Custom TTF, OTF, and WOFF font upload through the FontFace API.
- Cinematic character presets plus locally saved and importable render presets.
- Pan/zoom live preview and high-resolution PNG plus SVG export.
