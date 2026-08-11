// Local dev server: static files + /api/videos handler
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import handler from "./api/videos.js";

const ROOT = process.cwd();
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/videos") {
      // express-style wrapper for the Vercel handler
      const wrapped = {
        setHeader: (k, v) => res.setHeader(k, v),
        status(code) { res.statusCode = code; return this; },
        json(obj) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(obj));
          return this;
        },
      };
      return handler(req, wrapped);
    }
    let p = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const buf = await readFile(p);
      res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  })
  .listen(8787, () => console.log("http://localhost:8787"));
