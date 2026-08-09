import fs from "node:fs";

const path = "src/components/what-to-watch-app.tsx";
let source = fs.readFileSync(path, "utf8");

const before = `    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);`;
const after = `    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      } else {
        // Never let the PWA service worker cache Next.js development chunks.
        // A previously installed worker can otherwise keep localhost on stale
        // client code after branch switches or rebuilds.
        void navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .catch(() => undefined);
        if ("caches" in window) {
          void caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key.startsWith("what-to-watch-")).map((key) => caches.delete(key))))
            .catch(() => undefined);
        }
      }
    }`;

const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`Expected exactly one service-worker registration, found ${count}`);
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("Disabled PWA service-worker caching during local development.");
