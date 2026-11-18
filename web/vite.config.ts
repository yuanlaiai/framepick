import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 开发时把 /api 代理到本地 FastAPI（8790），生产构建输出到 web/dist，
// 由 FastAPI 的 StaticFiles 直接托管。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8790",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
