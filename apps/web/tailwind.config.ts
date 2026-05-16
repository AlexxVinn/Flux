import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        flux: {
          bg: "#0a0a0a", // Dark background
          panel: "#1a1a1a", // Panel background, slightly lighter than bg
          elevated: "#2a2a2a", // Elevated elements, buttons, etc.
          border: "rgba(255,255,255,0.1)", // Subtle white border
          accent: "#e8e8e8", // Primary text/accent for interactive elements (was blue)
          muted: "#888888", // Muted text for secondary info
          text: "#f5f5f5", // General text
          danger: "#dc2626", // Red for delete/danger actions
          focus: "#aaaaaa", // For focus states (subtle white/gray)
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
