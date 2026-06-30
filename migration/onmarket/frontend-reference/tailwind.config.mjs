/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#1F3864",
          light: "#2E5090",
        },
      },
    },
  },
  plugins: [],
};
