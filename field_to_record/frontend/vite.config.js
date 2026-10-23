import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-shell",
      generateBundle(_, bundle) {
        const assets = [
          "/",
          "/index.html",
          "/pcm-worklet.js",
          "/manifest.webmanifest",
          ...Object.keys(bundle)
            .filter((p) => !p.endsWith(".html"))
            .map((p) => "/" + p),
        ];
        const version = createHash("sha256")
          .update(JSON.stringify(assets))
          .digest("hex")
          .slice(0, 12);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE='ftr-${version}',ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin||new URL(e.request.url).pathname.startsWith('/api/')||new URL(e.request.url).pathname.startsWith('/health')||new URL(e.request.url).pathname.startsWith('/ready'))return;if(e.request.mode==='navigate'||new URL(e.request.url).pathname==='/'||new URL(e.request.url).pathname.endsWith('.html')){e.respondWith(fetch(e.request).then(res=>{const clone=res.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));return res}).catch(()=>caches.match(e.request)));return}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))})`,
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: process.env.API_TARGET || "http://127.0.0.1:8000",
        ws: true,
      },
      "/health": process.env.API_TARGET || "http://127.0.0.1:8000",
      "/readyz": process.env.API_TARGET || "http://127.0.0.1:8000",
    },
  },
  build: { target: "es2022" },
});
