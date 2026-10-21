import type { Config } from "tailwindcss";

// Colours are HSL channel triplets in CSS variables (src/index.css), so
// Tailwind opacity modifiers like `bg-danger/10` keep working.
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: token("card"),
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        primary: { DEFAULT: token("primary"), foreground: token("primary-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        success: token("success"),
        warning: token("warning"),
        danger: token("danger"),
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "calc(var(--radius) + 2px)",
      },
    },
  },
} satisfies Config;
