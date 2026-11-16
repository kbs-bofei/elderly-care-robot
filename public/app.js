const els = {
  messages: document.getElementById("messages"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  status: document.getElementById("status-line"),
  dot: document.querySelector(".status-dot"),
  hint: document.getElementById("hint"),
  clear: document.getElementById("clear-btn"),
  quick: document.getElementById("quick"),
  chat: document.getElementById("messages"),
  gallery: document.getElementById("gallery"),
  galleryGrid: document.getElementById("gallery-grid"),
  composer: document.getElementById("composer"),
  viewTitle: document.getElementById("view-title"),
  viewSub: document.getElementById("view-sub"),
  lightbox: document.getElementById("lightbox"),
  lightboxImg: document.getElementById("lightbox-img"),
  lightboxCaption: document.getElementById("lightbox-caption"),
  lightboxClose: document.getElementById("lightbox-close"),
  devToggle: document.getElementById("dev-toggle"),
};

// 开发者模式：调试信息默认隐藏，开关状态存入 localStorage。
const DEV_KEY = "xiaonuan-dev-mode";
function setDevMode(on) {
  document.body.classList.toggle("dev-mode", on);
  els.devToggle.checked = on;
  try { localStorage.setItem(DEV_KEY, on ? "1" : "0"); } catch {}
}
setDevMode(localStorage.getItem(DEV_KEY) === "1");
els.devToggle.addEventListener("change", () => setDevMode(els.devToggle.checked));

let sessionId = "session-" + Math.random().toString(36).slice(2, 10);
let busy = false;

const SUN = '<svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="16" cy="16" r="5" fill="currentColor" stroke="none"/><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.9 6.9 9 9M23 23l2.1 2.1M25.1 6.9 23 9M9 23l-2.1 2.1"/></svg>';

function scrollBottom() { els.messages.scrollTop = els.messages.scrollHeight; }

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function addBubble(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  if (role === "ai") {
    wrap.innerHTML = `<div class="ai-ava">${SUN}</div><div class="msg-col"><div class="bubble"></div><div class="bubble-time">${nowLabel()}</div></div>`;
  } else {
    wrap.innerHTML = `<div class="msg-col"><div class="bubble"></div><div class="bubble-time">${nowLabel()}</div></div>`;
  }
  const bubble = wrap.querySelector(".bubble");
  renderBubble(bubble, text);
  els.messages.appendChild(wrap);
  scrollBottom();
  return { bubble, raw: text };
}

// 把文本里的 〔照片：<file>〕 渲染成可点击的小卡片。
function renderBubble(el, text) {
  el.textContent = "";
  const re = /〔照片：([^〕]+)〕/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const btn = document.createElement("button");
    btn.className = "photo-link";
    btn.textContent = " 一张老照片 ";
    btn.onclick = () => openLightbox(m[1], "老照片");
    el.appendChild(btn);
    last = re.lastIndex;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

function addNote(cls, text) {
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  els.messages.appendChild(div);
  scrollBottom();
  return div;
}

// 加一条仅开发者可见的调试信息。
function addDevNote(cls, text) {
  return addNote(cls + " dev-only", text);
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  busy = true;
  els.input.disabled = true; els.send.disabled = true;
  addBubble("user", text);

  const reply = addBubble("ai", "正在想…");
  let gotText = false;
  let streamed = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === "text") { streamed += ev.text; if (!gotText) reply.bubble.textContent = ""; renderBubble(reply.bubble, streamed); gotText = true; scrollBottom(); }
        else if (ev.type === "status") addDevNote("status", "· " + ev.text);
        else if (ev.type === "tool") addDevNote("tool", `工具 ${ev.name}\n参数：${JSON.stringify(ev.args)}\n结果：${ev.result}`);
        else if (ev.type === "error") addNote("error", "出错了：" + ev.text);
        else if (ev.type === "done" && !gotText) reply.bubble.textContent = "（没有收到回复）";
      }
    }
  } catch (e) {
    addNote("error", "无法连接服务：" + e.message);
  } finally {
    busy = false;
    els.input.disabled = false; els.send.disabled = false; els.input.focus();
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value;
  els.input.value = "";
  sendMessage(text);
});

els.quick.addEventListener("click", (e) => {
  const q = e.target.getAttribute("data-q");
  if (q) sendMessage(q);
});

els.clear.addEventListener("click", async () => {
  await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, clear: true }),
  });
  els.messages.innerHTML = "";
  addBubble("ai", "您好呀，我是小暖。今天想聊点什么呢？");
});

function openLightbox(file, caption) {
  els.lightboxImg.src = "/media/" + file;
  els.lightboxCaption.textContent = caption;
  els.lightbox.hidden = false;
}
els.lightboxClose.onclick = () => { els.lightbox.hidden = true; };
els.lightbox.onclick = (e) => { if (e.target === els.lightbox) els.lightbox.hidden = true; };

function fmtDate(s) {
  const [y, m, d] = (s || "").split("-");
  return y && m ? `${y}年${Number(m)}月${Number(d)}日` : s || "";
}

async function loadGallery() {
  els.galleryGrid.innerHTML = '<div class="gallery-empty">正在翻找老照片…</div>';
  let items = [];
  try { items = await fetch("/api/media").then((r) => r.json()); } catch {}
  els.galleryGrid.innerHTML = "";
  if (!items || !items.length) {
    els.galleryGrid.innerHTML = '<div class="gallery-empty">还没有照片呢。放几张到回忆库，就能在这里翻看啦。</div>';
    return;
  }
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "photo-card";
    const tags = (it.tags || []).map((t) => `<span>${t}</span>`).join("");
    card.innerHTML = `
      <img src="/media/${it.file}" alt="${it.caption}">
      <div class="photo-meta">
        <div class="photo-caption">${it.caption}</div>
        <div class="photo-date">${fmtDate(it.takenAt)}</div>
        <div class="photo-tags">${tags}</div>
      </div>`;
    card.onclick = () => openLightbox(it.file, `${it.caption}（${fmtDate(it.takenAt)}）`);
    els.galleryGrid.appendChild(card);
  }
}

const VIEWS = {
  chat: { title: "陪伴对话", sub: "有什么想聊的，随时跟我说" },
  memory: { title: "回忆相册", sub: "从前的老照片，都在这里" },
  family: { title: "家人联系", sub: "" },
  health: { title: "健康提醒", sub: "" },
};

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const nav = btn.dataset.nav;
    const view = VIEWS[nav] || VIEWS.chat;
    els.viewTitle.textContent = view.title;
    const isChat = nav === "chat";
    const isMemory = nav === "memory";
    els.chat.hidden = !isChat;
    els.composer.hidden = !isChat;
    els.gallery.hidden = !isMemory;

    if (isMemory) { els.viewSub.textContent = view.sub; loadGallery(); }
    else if (isChat) els.viewSub.textContent = view.sub;
    else addNote("status", `「${view.title}」功能正在准备中`);
  });
});

fetch("/api/config").then((r) => r.json()).then((cfg) => {
  if (cfg.configured) {
    els.status.textContent = `在线 · ${cfg.model}`;
    els.dot.classList.add("online");
    els.hint.textContent = "已进入对话模式";
    els.input.disabled = false; els.send.disabled = false;
  } else {
    els.status.textContent = "未配置 API Key";
    els.hint.textContent = "请在 config.json 中填入 LLM_API_KEY 后重启服务";
  }
}).catch(() => {
  els.status.textContent = "服务连接失败";
});
