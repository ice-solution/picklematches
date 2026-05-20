/** @type {import('tailwindcss').Config} */
export default {
  content: ['./views/**/*.ejs', './src/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
