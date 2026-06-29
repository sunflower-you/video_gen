import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f6f7f9",
        panel: "#ffffff",
        line: "#d9dee7",
        ink: "#18202f",
        muted: "#667085",
        accent: "#1677ff",
        success: "#16855b",
        warning: "#b76e00",
        danger: "#c03535"
      },
      borderRadius: {
        panel: "8px"
      }
    }
  },
  plugins: []
};

export default config;
