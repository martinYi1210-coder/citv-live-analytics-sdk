import { defineConfig } from "vite"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  build: {
    target: "es2018",
    sourcemap: true,
    minify: "oxc",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        exports: "named",
      },
    },

    lib: {
      entry: resolve(rootDir, "src/index.ts"),

      // IIFE 构建后挂载到 window.CITVLiveAnalytics
      name: "CITVLiveAnalytics",

      formats: ["es", "iife"],

      fileName: (format) => {
        if (format === "es") {
          return "index.js"
        }

        return "citv-live-analytics-sdk.iife.js"
      }
    }
  }
})
