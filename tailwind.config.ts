import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Official Kashu brand palette
        brand: {
          50:  "#F0FDF8",
          100: "#E1FFA0",
          200: "#A8D5CB",
          300: "#5E9E96",
          400: "#64748B",
          500: "#334155",
          600: "rgb(var(--kw-brand-600-rgb) / <alpha-value>)",
          700: "rgb(var(--kw-brand-700-rgb) / <alpha-value>)",
          800: "#083028",
          900: "#061E19",
          950: "#030F0D",
        },
        accent: {
          DEFAULT: "rgb(var(--kw-accent-rgb) / <alpha-value>)",
          500: "#E1FFA0",
          600: "#00C07C",
        },
        highlight: "#E1FFA0",
        // Surface system for the elevated light theme
        surface: {
          50:  "#FAFBFE",   // page background
          100: "#F1F4F9",   // subtle card inset
          200: "#E8ECF4",   // borders, dividers
          300: "#D5DBE7",   // stronger borders
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"DM Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-lg": ["3.5rem", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "700" }],
        "display":    ["2.5rem", { lineHeight: "1", letterSpacing: "-0.025em", fontWeight: "700" }],
        "display-sm": ["2rem",   { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "stat":       ["1.75rem", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      boxShadow: {
        glow:           "0 0 0 3px rgba(0, 222, 143, 0.25)",
        "glow-sm":      "0 0 8px rgba(0, 222, 143, 0.35)",
        "glow-md":      "0 0 20px rgba(0, 222, 143, 0.35), 0 4px 12px rgba(0,0,0,0.08)",
        "glow-lg":      "0 0 40px rgba(0, 222, 143, 0.25), 0 8px 30px rgba(0,0,0,0.10)",
        // Elevated card system
        card:           "0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.03), 0 0 0 1px rgba(0,0,0,0.02)",
        "card-md":      "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)",
        "card-lg":      "0 12px 48px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
        "card-accent":  "0 0 0 1px rgba(0,222,143,0.18), 0 4px 24px rgba(0,222,143,0.10), 0 1px 3px rgba(0,0,0,0.04)",
        "card-glow":    "0 0 0 1px rgba(0,222,143,0.12), 0 8px 40px rgba(0,222,143,0.08), 0 2px 12px rgba(0,0,0,0.04)",
        sidebar:        "4px 0 48px rgba(0,0,0,0.3), 1px 0 0 rgba(255,255,255,0.05)",
        "inner-glow":   "inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(0,0,0,0.02)",
        "glass":        "0 8px 32px rgba(0,0,0,0.06), 0 0 0 1px rgba(255,255,255,0.6), inset 0 1px 0 rgba(255,255,255,0.8)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
        "4xl": "1.5rem",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeInUp: {
          "0%":   { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%":   { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideIn: {
          "0%":   { transform: "translateX(-14px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        scaleIn: {
          "0%":   { transform: "scale(0.96)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        drawLine: {
          "0%":   { strokeDashoffset: "1000" },
          "100%": { strokeDashoffset: "0" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 8px rgba(0,222,143,0.25), 0 1px 3px rgba(0,0,0,0.06)" },
          "50%":      { boxShadow: "0 0 32px rgba(0,222,143,0.45), 0 4px 16px rgba(0,0,0,0.08)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%":      { transform: "translateY(-5px)" },
        },
        spin: {
          "0%":   { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        revealUp: {
          "0%":   { opacity: "0", transform: "translateY(24px) scale(0.98)" },
          "60%":  { opacity: "1", transform: "translateY(-2px) scale(1.005)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.4" },
          "50%":      { opacity: "0.8" },
        },
        orbDrift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%":      { transform: "translate(30px, -20px) scale(1.1)" },
          "66%":      { transform: "translate(-20px, 15px) scale(0.95)" },
        },
      },
      animation: {
        "fade-in":     "fadeIn 0.3s ease-out",
        "fade-in-up":  "fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-up":    "slideUp 0.3s ease-out",
        "slide-in":    "slideIn 0.25s ease-out",
        "scale-in":    "scaleIn 0.2s ease-out",
        "draw-line":   "drawLine 1.5s ease-out forwards",
        "pulse-glow":  "pulseGlow 3s ease-in-out infinite",
        "shimmer":     "shimmer 2s linear infinite",
        "float":       "float 3s ease-in-out infinite",
        "reveal-up":   "revealUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        "breathe":     "breathe 4s ease-in-out infinite",
        "orb-drift":   "orbDrift 20s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
