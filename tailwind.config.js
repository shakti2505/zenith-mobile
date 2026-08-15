/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,jsx,ts,tsx}",
    "./src/components/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        industrial: {
          dark: "#0F172A",
          card: "#1E293B",
          accent: "#3B82F6",
          warning: "#F59E0B",
          success: "#10B981",
        },
      },
    },
  },
  plugins: [],
};
