import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In local dev, Vite runs the frontend only. This proxies /api calls
      // to the local serverless function runner (see README "Local API" section).
      "/api": "http://localhost:3000",
    },
  },
});
