/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html'],
  theme: {
    extend: {
      colors: {
        // "blue" di-remap jadi navy gelap supaya seluruh kelas bg-blue-*/
        // text-blue-*/border-blue-* yang sudah ada di markup & JS otomatis
        // ikut berubah tanpa perlu cari-ganti ratusan kelas satu-satu.
        blue: {
          50: '#eef1fb',
          100: '#dbe2f4',
          200: '#b3c1e6',
          300: '#8497ce',
          400: '#5a6fac',
          500: '#374d87',
          600: '#1c2f61',
          700: '#16244d',
          800: '#111b3a',
          900: '#0a1228',
        },
        gold: {
          50: '#fdf8ec',
          100: '#f9edc9',
          200: '#f0dc93',
          300: '#e4c467',
          400: '#d6ac42',
          500: '#c2932e',
          600: '#a17423',
          700: '#7d591c',
        },
      },
      fontFamily: {
        display: ['Sora', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
