import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'resq-navy': '#001F3F',
        'resq-blue': '#2563eb',
        'medical-white': '#ffffff',
      },
    },
  },
  plugins: [],
}
export default config
