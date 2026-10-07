import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Porta fixa: o Tauri carrega http://localhost:1420 em desenvolvimento.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/servico/**"] },
  },
  build: {
    target: "es2023",
  },
});
