import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: { colors: { ink: '#16233b', teal: '#0b8f87' } } },
  plugins: [],
};
export default config;
