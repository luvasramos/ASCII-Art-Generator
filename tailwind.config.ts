import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Funnel Sans", "Inter", "Geist", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "ui-sans-serif", "system-ui"],
        mono: ["Chivo Mono", "ui-monospace", "monospace"]
      },
      colors: {
        ink: "#0B0B0C",
        panel: "#131316",
        panel2: "#1A1B1F",
        line: "rgba(255,255,255,0.05)",
        paper: "#F3F4F6",
        signal: "#9F39FF",
        ember: "#F2B86D"
      },
      boxShadow: {
        studio: "0 8px 24px rgba(0, 0, 0, 0.24)",
        soft: "0 8px 24px rgba(0, 0, 0, 0.18)",
        focus: "0 0 0 1px rgba(159, 57, 255, 0.42)"
      }
    }
  },
  plugins: []
} satisfies Config;
