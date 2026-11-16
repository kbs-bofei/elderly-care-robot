// agent.mjs — 最小 Agent 循环：LLM 调用 + 工具调用，OpenAI 兼容 API。
import { buildSystemPrompt } from "./prompt.mjs";
import { toolDefinitions, runTool } from "./tools.mjs";

const API_BASE = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 8;

// 会话历史，按 sessionId 保存在内存中（原型用）。
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

// 构造给 LLM 的请求体。
function makeBody(messages, stream) {
  return {
    model: MODEL,
    messages,
    tools: toolDefinitions,
    tool_choice: "auto",
    stream,
    temperature: 0.7,
  };
}

async function callLLM(messages, stream) {
  const resp = await fetch(`${API_BASE.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(makeBody(messages, stream)),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LLM API 错误 ${resp.status}: ${t.slice(0, 500)}`);
  }
  return resp;
}

// 解析 OpenAI 流式 SSE，产出文本增量与 tool_calls 增量。
async function streamChat(messages, emit) {
  const resp = await callLLM(messages, true);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let toolCalls = [];
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      const delta = chunk.choices?.[0]?.delta || {};
      if (delta.content) {
        fullText += delta.content;
        emit({ type: "text", text: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }
  }
  return { text: fullText, toolCalls: toolCalls.filter(Boolean) };
}

// 处理一条用户消息：Agent 循环，流式推送事件给回调 emit。
export async function handleMessage(sessionId, userText, emit) {
  const history = getHistory(sessionId);
  history.push({ role: "user", content: userText });

  const systemPrompt = await buildSystemPrompt();
  const messages = [{ role: "system", content: systemPrompt }, ...history];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { text, toolCalls } = await streamChat(messages, emit);

    if (!toolCalls.length) {
      if (text) history.push({ role: "assistant", content: text });
      return;
    }

    emit({ type: "status", text: `调用工具：${toolCalls.map((t) => t.function.name).join("、")}` });
    const assistantMsg = { role: "assistant", content: null, tool_calls: toolCalls };
    messages.push(assistantMsg);

    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      const result = await runTool(tc.function.name, args);
      emit({ type: "tool", name: tc.function.name, args, result: result.slice(0, 2000) });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
    continue;
  }

  emit({ type: "text", text: "\n（已达到工具调用轮次上限，先到此为止。）" });
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}
