import path from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

/**
 * Builds src/sw.ts into a single classic script at /sw.js (no shared chunks, no hash),
 * which is what browsers need to register a service worker at the site root.
 */
function serviceWorker(): Plugin {
  const bundle = async (write: boolean, minify: boolean) => {
    const result = await build({
      configFile: false,
      root,
      logLevel: "error",
      publicDir: false,
      resolve: { alias: { "@": path.resolve(root, "./src") } },
      define: { "process.env.NODE_ENV": JSON.stringify(minify ? "production" : "development") },
      build: {
        write,
        minify,
        emptyOutDir: false,
        outDir: path.resolve(root, "dist"),
        copyPublicDir: false,
        lib: { entry: path.resolve(root, "src/sw.ts"), formats: ["iife"], name: "nostrBuzzSw", fileName: () => "sw.js" },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result) as { output?: { type: string; code?: string }[] };
    return output.output?.find((chunk) => chunk.type === "chunk")?.code ?? "";
  };

  return {
    name: "nostr-buzz-service-worker",
    apply: (_config, env) => !process.env.VITEST && (env.command === "serve" || !env.isSsrBuild),
    async closeBundle() {
      if (this.environment?.config.command === "build") await bundle(true, true);
    },
    configureServer(server) {
      server.middlewares.use("/sw.js", (_request, response) => {
        bundle(false, false).then(
          (code) => {
            response.setHeader("Content-Type", "text/javascript");
            response.setHeader("Cache-Control", "no-cache");
            response.end(code);
          },
          (error: unknown) => {
            response.statusCode = 500;
            response.end(`// ${String(error)}`);
          },
        );
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    tailwindcss(),
    serviceWorker(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/{vite,eslint}.config.*',
      '.agents/**',
    ],
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: '0', // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
}));