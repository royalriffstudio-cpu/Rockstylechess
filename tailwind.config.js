/**
 * NativeWind config for the fused new_ui redesign. Scoped to the files this
 * fusion actually touches (route screens + shared ui components), not the
 * whole src/ tree -- puzzle-match.tsx/bands.tsx are explicitly excluded
 * (untouched, fully-production-owned screens with no new_ui mockup).
 * match.tsx's chrome was reskinned to NativeWind in a later pass, so it's
 * no longer excluded.
 *
 * Every token below is a direct copy of src/constants/theme.ts's real
 * Colors/Fonts/Radius/Spacing values (kebab-cased for className use) --
 * theme.ts remains the single source of truth; keep both in sync manually
 * when a token changes there.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/ui/**/*.{ts,tsx}",
    "./src/components/layout/**/*.{ts,tsx}",
    "!./src/app/(play)/puzzle-match.tsx",
    "!./src/app/(social)/bands.tsx",
    "!./src/app/dev-preview.tsx",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ember: "#FF5A1F",
        "ember-light": "#FF9248",
        gold: "#FFC23A",
        cyan: "#2FE6FF",
        crimson: "#E11D2A",

        chrome: "#F1F3F7",
        "chrome-mid": "#A6ACB8",
        "chrome-dark": "#5C6069",

        "board-light": "#DEDBD6",
        "board-dark": "#373D47",
        "board-edge": "#20242C",

        "piece-white-hi": "#FFFFFF",
        "piece-white-mid": "#DEE2E8",
        "piece-white-lo": "#98A0AC",
        "piece-black-hi": "#5B616C",
        "piece-black-mid": "#2C3037",
        "piece-black-lo": "#101216",

        "text-primary": "#F5EFF1",
        "text-muted": "#A294A0",

        "bg-base": "#0B0709",
        "bg-panel": "#17101A",
      },
      borderRadius: {
        DEFAULT: "8px",
        sm: "8px",
        md: "14px",
        lg: "15px",
        full: "999px",
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        // Screen-edge padding + bento-grid gutter, matching new_ui's own
        // tokens -- many fused screens use `px-margin-mobile` / `gap-gutter`.
        gutter: "16px",
        "margin-mobile": "16px",
      },
      // Semantic type-scale recipes, sourced from the same ui.html/DESIGN.md
      // typography spec new_ui's screens were built against -- family names
      // resolve to theme.ts's real Fonts.display/heading/body strings.
      fontFamily: {
        "body-sm": ["Inter_400Regular"],
        "section-header": ["Oswald_600SemiBold"],
        "button-label": ["Oswald_600SemiBold"],
        "display-hero": ["Anton_400Regular"],
        "headline-lg": ["Anton_400Regular"],
        "heading-md": ["Oswald_600SemiBold"],
        caption: ["Inter_400Regular"],
        "body-base": ["Inter_400Regular"],
      },
      fontSize: {
        "body-sm": ["14px", { lineHeight: "1.4", fontWeight: "400" }],
        "section-header": [
          "13px",
          { lineHeight: "1", letterSpacing: "2px", fontWeight: "600" },
        ],
        "button-label": [
          "16px",
          { lineHeight: "1", letterSpacing: "0.5px", fontWeight: "600" },
        ],
        "display-hero": [
          "48px",
          { lineHeight: "1.1", letterSpacing: "0.02em", fontWeight: "400" },
        ],
        "headline-lg": [
          "32px",
          { lineHeight: "1.2", letterSpacing: "0.05em", fontWeight: "400" },
        ],
        "heading-md": ["20px", { lineHeight: "1.4", fontWeight: "600" }],
        caption: ["11px", { lineHeight: "1.2", fontWeight: "400" }],
        "body-base": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
      },
    },
  },
  plugins: [],
};
