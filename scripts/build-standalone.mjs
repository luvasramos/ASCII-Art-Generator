import { build } from "esbuild";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

const bootFallback = String.raw`
    <script>
      window.__asciiBootError = function (message) {
        var status = document.getElementById("boot-status");
        if (!status || document.body.dataset.appMounted === "true") return;
        status.textContent =
          message ||
          "App did not start. Open the browser console for errors, or rebuild the standalone dist folder.";
      };

      window.addEventListener("error", function (event) {
        window.__asciiBootError(
          "App did not start. " +
            (event.message || "A JavaScript error prevented startup.") +
            " Open the browser console for details."
        );
      });

      window.setTimeout(function () {
        if (document.body.dataset.appMounted !== "true") {
          window.__asciiBootError(
            "App did not start. If this was copied from a zip, keep index.html next to the assets folder and open dist/index.html."
          );
        }
      }, 3000);
    </script>`;

const standaloneHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0b0c0f" />
    <title>ASCII Rendering Studio</title>
    <link rel="stylesheet" href="./assets/app.css" />
  </head>
  <body>
    <noscript>
      <div style="min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f4f1e8;font:16px system-ui;padding:24px;">
        JavaScript is required to run ASCII Rendering Studio.
      </div>
    </noscript>
    <div id="root">
      <div style="min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f4f1e8;font:16px system-ui;padding:24px;text-align:center;">
        <div>
          <div style="font-size:18px;font-weight:650;">Loading ASCII Rendering Studio...</div>
          <div id="boot-status" style="margin-top:12px;max-width:560px;color:#a1a1aa;font-size:14px;line-height:1.6;">
            Starting the standalone app.
          </div>
        </div>
      </div>
    </div>
${bootFallback}
    <script src="./assets/app.js"></script>
  </body>
</html>
`;

const findGeneratedCss = async () => {
  const files = await readdir(assets);
  const css = files.find((file) => /^index-.*\.css$/.test(file));
  if (!css) {
    throw new Error("Could not find Vite-generated CSS in dist/assets.");
  }
  return path.join(assets, css);
};

const cssPath = await findGeneratedCss();
const css = await readFile(cssPath, "utf8");

await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await writeFile(path.join(assets, "app.css"), css);

await build({
  entryPoints: [path.join(root, "src", "standalone.tsx")],
  outfile: path.join(assets, "app.js"),
  bundle: true,
  format: "iife",
  globalName: "AsciiRenderingStudio",
  platform: "browser",
  target: "es2018",
  minify: true,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
    __ASCII_STANDALONE__: "true"
  }
});

const appJsPath = path.join(assets, "app.js");
const appJs = await readFile(appJsPath, "utf8");
await writeFile(
  appJsPath,
  appJs
    .replace(/https:\/\/reactjs\.org\/docs\/error-decoder\.html\?invariant=/g, "React error ")
    .replace(/http:\/\/www\.w3\.org\/1999\/xlink/g, "urn:xlink")
    .replace(/http:\/\/www\.w3\.org\/XML\/1998\/namespace/g, "urn:xml")
);

await writeFile(path.join(dist, "index.html"), standaloneHtml);
