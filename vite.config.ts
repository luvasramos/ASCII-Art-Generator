import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.wasm"],
  plugins: [react()],
  worker: {
    format: "es"
  }
});
