/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "media",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        foreground: "var(--fg)",
        card: "var(--card-bg)",
        "card-foreground": "var(--card-fg)",
        border: "var(--border)",
      },
    },
  },
  plugins: [],
}
