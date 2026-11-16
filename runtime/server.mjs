// server.mjs — 零依赖 HTTP 服务：静态界面 + 流式聊天 API。
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.env.PROJECT_ROOT || path.resolve(import.meta.dirname, ".."));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);

// 从项目根目录 config.json 加载配置（若存在），作为环境变量的补充。
// 注意：必须在 import agent.mjs 之前加载——agent.mjs 顶层会读取 LLM_* 环境变量。
try {
  const cfg = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"));
  for (const [k, v] of Object.entries(cfg)) {
    if (v && !process.env[k]) process.env[k] = String(v);
  }
} catch {}

// 动态导入：确保上面的 config 已写入 process.env，agent 才能读到正确的 Key/地址/模型。
const { handleMessage, clearSession } = await import("./agent.mjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function safeJoin(root, rel) {
  const abs = path.resolve(root, rel);
  return (abs === root || abs.startsWith(root + path.sep)) ? abs : null;
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const abs = path.join(PUBLIC, rel);
  if (!abs.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
  try {
    const buf = await readFile(abs);
    res.writeHead(200, { "Content-Type": MIME[path.extname(abs)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, model: process.env.LLM_MODEL || "gpt-4o-mini" });
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    const key = process.env.LLM_API_KEY || "";
    const configured = Boolean(key) && !/这里|填你的|your.?key|sk-xxx/i.test(key);
    return json(res, 200, {
      configured,
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    });
  }

  if (req.method === "GET" && url.pathname === "/api/media") {
    try {
      const idx = JSON.parse(await readFile(path.join(ROOT, "agent_state/media-library/index.json"), "utf8"));
      return json(res, 200, idx);
    } catch { return json(res, 200, []); }
  }

  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    // index.json 里的 file 是相对 media-library 的路径（如 media/xxx.svg）。
    const rel = "agent_state/media-library/" + url.pathname.replace(/^\/media\//, "");
    const abs = safeJoin(ROOT, rel);
    if (!abs) return json(res, 403, { error: "forbidden" });
    try {
      const buf = await readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const type = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      return res.end(buf);
    } catch { return json(res, 404, { error: "not found" }); }
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload;
    try { payload = JSON.parse(body); } catch { return json(res, 400, { error: "invalid json" }); }

    const sessionId = payload.sessionId || "default";
    if (payload.clear) {
      clearSession(sessionId);
      return json(res, 200, { ok: true });
    }

    if (!payload.message) return json(res, 400, { error: "message required" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      await handleMessage(sessionId, payload.message, send);
    } catch (err) {
      send({ type: "error", text: err.message });
    }
    send({ type: "done" });
    return res.end();
  }

  if (req.method === "GET") return serveStatic(req, res, url.pathname);
  json(res, 405, { error: "method not allowed" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`小暖原型已启动：http://127.0.0.1:${PORT}`);
  console.log(`模型：${process.env.LLM_MODEL || "gpt-4o-mini"}｜API Key：${process.env.LLM_API_KEY ? "已配置" : "未配置（需在 config.json 或环境变量中设置）"}`);
});
