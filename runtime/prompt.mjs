// prompt.mjs — 拼装最终 system prompt，替代 PenguinHarness 的 {{占位符}} 模板注入。
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.env.PROJECT_ROOT || path.resolve(import.meta.dirname, ".."));
const STATE = path.join(ROOT, "agent_state");
const p = (rel) => path.join(STATE, rel);

async function readOr(rel, fallback = "") {
  try {
    return await readFile(p(rel), "utf8");
  } catch {
    return fallback;
  }
}

// 从各 SKILL.md 的 frontmatter 提取 name + description，作为元数据注入。
// 只注入通用技能，跳过平台专属的 penguin-* / rsi-toolkit 系列。
const PLATFORM_ONLY = /^(penguin-|plugin-porting|skill-porting|agent-|.*rsi-toolkit|benchmark-design|unified-llm-api|llamafactory|ollama|vllm)/;

async function buildSkillsMetadata() {
  let skillsDir;
  try {
    skillsDir = await readdir(p("skills"), { withFileTypes: true });
  } catch {
    return "(无可用技能)";
  }
  const lines = [];
  for (const entry of skillsDir) {
    if (!entry.isDirectory() || PLATFORM_ONLY.test(entry.name)) continue;
    const text = await readOr(`skills/${entry.name}/SKILL.md`);
    const desc = text.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "(无描述)";
    lines.push(`- ${entry.name}: ${desc}`);
  }
  return lines.length ? lines.join("\n") : "(无可用技能)";
}

// 调用 local-time hook 脚本，拿到带口语说法的时间上下文。
async function buildTimeContext() {
  try {
    const script = path.join(STATE, "hooks/local-time/time.mjs");
    const { stdout } = await execFileAsync(process.execPath, [script], { timeout: 5000 });
    const parsed = JSON.parse(stdout.trim().split("\n").pop());
    return parsed.context || "";
  } catch {
    return "(时间信息暂不可用)";
  }
}

export async function buildSystemPrompt() {
  const [template, agentsMd, memoryIndex, skills, time] = await Promise.all([
    readOr("system_prompt.md"),
    readOr("AGENTS.md"),
    readOr("memory/user/MEMORY.md", "(暂无记忆)"),
    buildSkillsMetadata(),
    buildTimeContext(),
  ]);
  return template
    .replace("{{TIME_CONTEXT}}", time)
    .replace("{{AGENTS_MD}}", agentsMd)
    .replace("{{MEMORY_INDEX}}", memoryIndex)
    .replace("{{SKILLS_METADATA}}", skills);
}
