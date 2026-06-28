import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import newsHandler from "../api/news.js";

const root = new URL("../public/", import.meta.url);
const projectRoot = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const port = Number(process.env.PORT || 4173);

await loadLocalEnv();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);

    if (url.pathname === "/api/news") {
      await newsHandler(request, createVercelResponse(response));
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    const fileUrl = new URL(`.${safePath}`, root);
    const body = await readFile(fileUrl);
    response.writeHead(200, {
      "Content-Type": types[extname(fileUrl.pathname)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    const body = await readFile(join(rootPath, "index.html"));
    response.writeHead(200, { "Content-Type": types[".html"] });
    response.end(body);
  }
}).listen(port, () => {
  console.log(`Mondo Chiaro preview: http://localhost:${port}`);
});

function createVercelResponse(response) {
  response.statusCode = 200;

  return {
    setHeader(key, value) {
      response.setHeader(key, value);
    },
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(payload) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(payload));
    }
  };
}

async function loadLocalEnv() {
  try {
    const env = await readFile(new URL(".env", projectRoot), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Local env file is optional.
  }
}
