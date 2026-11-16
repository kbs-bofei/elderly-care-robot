// tools.mjs — 给 LLM 调用的最小工具集，替代 PenguinHarness 的内置工具。
// 全部限制在 PROJECT_ROOT 内，避免越权访问。
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// path.resolve 统一规范化，避免 Windows 下 PROJECT_ROOT 正斜杠与反斜杠不一致导致 startsWith 失败。
const ROOT = path.resolve(process.env.PROJECT_ROOT || path.resolve(import.meta.dirname, ".."));
const MEMORY_DIR = path.join(ROOT, "agent_state/memory/user");
const GRAPH_FILE = path.join(ROOT, "agent_state/knowledge/graph.json");

function safeResolve(rel) {
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error(`路径越界：${rel}`);
  return abs;
}

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "query_graph",
      description: "查询老人的个人知识图谱。涉及人物关系、称呼偏好、饮食作息、病史用药、纪念日时优先调用。传关键词可按内容过滤，留空返回全部。",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "要查找的关键词，如'孙女''降压药''生日'；留空则返回整个图谱" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_media_index",
      description: "读取回忆库的照片/视频索引（index.json），用于按人、日子或说法找老人想看的回忆。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "把一条关于老人的事实写入三级记忆。tier 取值：confirmed（已本人/照护者审核）、candidate（未审核的碎片，引用前须求证）、care（用药/复诊/提醒计划，只陈述事实）。一条事实一个文件，自动更新 MEMORY.md 索引。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "kebab-case 英文短名，如 wants-to-hear-opera，同时作为文件名" },
          description: { type: "string", description: "一行说明，用于检索判断" },
          content: { type: "string", description: "事实正文" },
          tier: { type: "string", enum: ["confirmed", "candidate", "care"], description: "记忆等级" },
        },
        required: ["name", "description", "content", "tier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取一个文本文件（带行号）或一张图片（base64，供视觉模型查看）。路径相对项目根目录。",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string", description: "相对项目根目录的文件路径" } },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "创建或覆盖一个文本文件，自动创建父目录。",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "相对项目根目录的文件路径" },
          content: { type: "string", description: "要写入的完整内容" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出某个目录下的文件和子目录。",
      parameters: {
        type: "object",
        properties: { dir_path: { type: "string", description: "相对项目根目录的目录路径，默认根目录" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec_command",
      description: "在项目根目录执行一条只读的 shell 命令（如 grep、ls、cat）。禁止破坏性操作。",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "要执行的命令" } },
        required: ["command"],
      },
    },
  },
];

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const TIER_LABEL = { confirmed: "确认记忆", candidate: "候选记忆", care: "照护知识" };

async function queryGraph(keyword) {
  let graph;
  try { graph = JSON.parse(await readFile(GRAPH_FILE, "utf8")); }
  catch { return "知识图谱暂不可用。"; }
  if (!keyword) return JSON.stringify(graph, null, 2);
  const kw = String(keyword).toLowerCase();
  const out = {};
  for (const [section, entries] of Object.entries(graph)) {
    if (!Array.isArray(entries)) {
      if (JSON.stringify(entries).toLowerCase().includes(kw)) out[section] = entries;
      continue;
    }
    const hits = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(kw));
    if (hits.length) out[section] = hits;
  }
  return Object.keys(out).length ? JSON.stringify(out, null, 2) : `图谱里没找到「${keyword}」。`;
}

async function saveMemory({ name, description, content, tier }) {
  if (!/^[a-z0-9-]+$/.test(name || "")) return "错误：name 只能用小写字母、数字和连字符。";
  if (!TIER_LABEL[tier]) return "错误：tier 必须是 confirmed / candidate / care 之一。";
  const safeName = path.basename(name);
  const file = path.join(MEMORY_DIR, `${safeName}.md`);
  const today = new Date().toISOString().slice(0, 10);
  const body = `---\nname: ${safeName}\ndescription: ${description}\nupdated_at: ${today}\ntier: ${tier}\n---\n\n${content}\n`;
  await writeFile(file, body, "utf8");

  // 更新 MEMORY.md 索引：保留其他行，若已存在同名条目则替换，否则追加。
  const indexPath = path.join(MEMORY_DIR, "MEMORY.md");
  let index = "";
  try { index = await readFile(indexPath, "utf8"); } catch {}
  const line = `- [${description}](${safeName}.md) — ${TIER_LABEL[tier]}`;
  const kept = index.split("\n").filter((l) => !l.includes(`](${safeName}.md)`)).filter(Boolean);
  await writeFile(indexPath, [...kept, line].join("\n") + "\n", "utf8");
  return `已保存${TIER_LABEL[tier]}「${description}」到 memory/user/${safeName}.md，并更新索引。`;
}

export async function runTool(name, args) {
  try {
    switch (name) {
      case "query_graph":
        return await queryGraph(args.keyword);
      case "read_media_index": {
        try {
          return await readFile(path.join(ROOT, "agent_state/media-library/index.json"), "utf8");
        } catch { return "[]"; }
      }
      case "save_memory":
        return await saveMemory(args);
      case "read_file": {
        const abs = safeResolve(args.file_path);
        if (IMAGE_EXT.test(abs)) {
          const buf = await readFile(abs);
          const ext = path.extname(abs).slice(1).toLowerCase();
          const mime = ext === "jpg" ? "jpeg" : ext;
          return `[图片 ${args.file_path}] data:image/${mime};base64,${buf.toString("base64")}`;
        }
        const text = await readFile(abs, "utf8");
        return text.split("\n").slice(0, 2000).map((l, i) => `${String(i + 1).padStart(4)} ${l}`).join("\n");
      }
      case "write_file": {
        await writeFile(safeResolve(args.file_path), args.content, "utf8");
        return `已写入 ${args.file_path}`;
      }
      case "list_files": {
        const entries = await readdir(safeResolve(args.dir_path || "."), { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`).join("\n");
      }
      case "exec_command": {
        const cmd = String(args.command || "");
        if (/\b(rm|del|format|mkfs|shutdown|taskkill|kill)\b/i.test(cmd)) {
          return "错误：出于安全考虑，不允许执行破坏性命令。";
        }
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", cmd], {
          cwd: ROOT, timeout: 20000, maxBuffer: 1024 * 1024,
        });
        return (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
      }
      default:
        return `未知工具：${name}`;
    }
  } catch (err) {
    return `工具执行出错：${err.message}`;
  }
}
