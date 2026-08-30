import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Frontend talks only to the Node API, never directly to Python.
      "/api": "http://localhost:4000",
    },
  },
});
