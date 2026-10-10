import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "simulator-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: new URL("./simulator.html", import.meta.url).pathname,
    },
  },
});
