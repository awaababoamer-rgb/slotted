import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The schedule engine lives in its own folder (../engine) so it can be tested on its own.
      "@slotted/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
    },
  },
  server: {
    // Allow reading ../engine and ../data/courses.json from outside web/.
    fs: { allow: [".."] },
  },
});
