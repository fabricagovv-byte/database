/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiAlvo = process.env.VITE_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: apiAlvo, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  preview: {
    port: 5173,
    proxy: { "/api": { target: apiAlvo, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
