# ASCII Rendering Studio

ASCII Rendering Studio is a browser-based image and video rendering tool for creating layered ASCII artwork, still exports, and animated exports.

## Run Locally

Install dependencies, then start the Vite development server:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Build

Create the production standalone build:

```bash
npm run build
```

The built app is written to `dist/index.html` with its assets in `dist/assets`. The standalone build can be opened directly from `dist/index.html`.

## Deploy

GitHub Pages is configured to serve from:

```text
main / docs
```

Build and copy the standalone output into `docs`:

```bash
npm run build:pages
```

Equivalent manual flow:

```bash
npm run build
xcopy dist docs /E /Y
git add docs
git commit -m "Deploy build"
git push origin <current-branch>:main --force-with-lease
```

The npm deploy helpers only build and copy files. They do not commit or push.

## Preview Model

The live preview is optimized for editing responsiveness with adaptive preview performance. It may reduce preview display work to stay interactive.

Use Preview Animation for the true-FPS animation preview. It renders frames first, caches them, then plays the cached result at the configured animation FPS.

## Supported Exports

- PNG
- SVG
- PNG sequence ZIP
- GIF
- MP4
- WebM

## Notes

Standalone builds use browser APIs for rendering and export. Keep `dist/index.html` next to the `dist/assets` folder when copying or zipping the built app.
