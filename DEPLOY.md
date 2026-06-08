# Deploying to GitHub Pages

This project deploys GitHub Pages from:

```text
main / docs
```

Build the standalone app, copy the fresh output into `docs`, then publish the `docs` folder on `main`.

```bash
npm run build
xcopy dist docs /E /Y
git add docs
git commit -m "Deploy build"
git push origin <current-branch>:main --force-with-lease
```

The npm helper below performs only the build and copy steps. It does not commit or push.

```bash
npm run build:pages
```

Use `deploy:pages` as an alias for the same local build-and-copy flow:

```bash
npm run deploy:pages
```
