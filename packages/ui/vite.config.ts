import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri, bu Vite dev sunucusuna (devUrl) bağlanır; üretimde `dist` statiklerini paketler.
// strictPort: Tauri'nin tauri.conf.json'daki devUrl'i ile sabit kalması için.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
