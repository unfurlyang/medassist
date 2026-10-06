'use strict';

/* ============================================================
 * 医询 MedAssist · UI 逻辑
 * 默认: 本地知识库匹配（离线）。可选: LLM 增强模式（用户自带 key）。
 * ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentTab = "analyze";
let lastResult = null;   // 本地引擎结果
let llmResult = null;    // LLM 增强结果

/* ---------- Toast ---------- */
function toast(msg, type) {
  const t = document.createElement("div");
  t.className = "toast" + (type === "err" ? " err" : "");
  t.textContent = msg;
  $("#toastWrap").appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

/* ---------- Tab 切换 ---------- */
function switchTab(name) {
  currentTab = name;
  $$(".tab-page").forEach(s => { s.hidden = s.id !== "tab-" + name; });
  $$("#mainTabs .tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "drugs") renderDrugs($("#drugSearch").value.trim());
  if (name === "about") renderAbout();
  if (name === "kg") renderKgStats();
  if (name === "analyze" && lastResult) MedKG.draw($("#kgCanvas"), lastResult);
}

/* ---------- 快捷 chips ---------- */
function renderChips() {
  const wrap = $("#quickChips");
  wrap.innerHTML = QUICK_CHIPS.map(c =>
    `<button type="button" class="chip" data-kw="${c}">${c}</button>`).join("");
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (btn) btn.classList.toggle("on");
  });
}

/* ---------- 结果渲染 ---------- */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function drugMini(m) {
  return `<div class="drug-mini">
    <span class="drug-badge${m.otc ? "" : " rx"}">${m.otc ? "OTC" : "处方"}</span>
    <div><b>${escapeHtml(m.name)}</b>
      <div class="m">${escapeHtml(m.use)}</div>
      <div class="m">⚠ ${escapeHtml(m.warn[0] || "")}</div>
    </div></div>`;
}

function renderResults(res, source) {
  const area = $("#resultArea");
  $("#resultMeta").textContent = `数据来源：${source} · ${new Date().toLocaleTimeString("zh-CN")}`;
  let html = "";

  if (res.redflags && res.redflags.length) {
    html += `<div class="redflag-banner">
      <h3>🚨 检测到需要立即就医的信号 —— 已暂停常规推荐</h3>
      ${res.redflags.map(f => `<div class="rf-item">
        <div class="rf-name">疑似：${escapeHtml(f.name)}</div>
        <div class="rf-action">👉 ${escapeHtml(f.action)}</div>
        <div class="rf-detail">${escapeHtml(f.detail)}</div>
      </div>`).join("")}
      <div style="margin-top:8px;font-size:12.5px;opacity:.9">以下病症信息仅供陪同就医时参考，请以急救人员判断为准。</div>
    </div>`;
  }

  if (!res.results || !res.results.length) {
    html += `<div class="placeholder">${res.redflags && res.redflags.length
      ? "已按急症流程处理：请立即执行上方急救行动，不要等待本工具的进一步分析。其余症状信息可在就医时口头向医生补充。"
      : "没有匹配到足够的症状信息。请补充描述（部位 + 感觉 + 持续时间），例如\"嗓子疼两天、吞咽时更明显\"。"}</div>`;
  } else {
    if (res.source === "llm") {
      html += `<div class="hint">🤖 以下为 AI 增强分析（大模型生成，仍不构成医疗建议，请核对后再参考）：</div>`;
    }
    res.results.forEach((r, i) => {
      const isRef = r.tier === "ref";
      const lead = (!isRef && res.results.findIndex(x => x.tier !== "ref") === i) ? "🥇" : "▷";
      const pctBlock = isRef
        ? `<span class="pct-num"><span class="dx-ref-badge">相关方向 · 供参考</span></span>`
        : `<div class="pct-wrap"><div class="pct-bar"><div class="pct-fill" style="width:${r.pct}%"></div></div>
          <span class="pct-num">相关度 ${r.pct}%</span></div>`;
      html += `<div class="dx-card${isRef ? " ref" : ""}">
        <div class="dx-head"><h3>${lead} ${escapeHtml(r.name)}</h3>
          <span class="dx-dept">建议科室：${escapeHtml(r.dept)}</span></div>
        ${pctBlock}
        <div class="ev-chips">${r.evidence.map(e => `<span>${escapeHtml(e)}</span>`).join("")}</div>
        ${r.otc && r.otc.length ? `<div class="sub-h">常用药物信息（OTC · 供了解核对）</div>
          ${r.otc.map(drugMini).join("")}` : ""}
        ${r.rx_note ? `<div class="rx-note">💊 ${escapeHtml(r.rx_note)}</div>` : ""}
        <div class="sub-h">非药物建议</div>
        <ul class="advice-list">${r.advice.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
        ${r.redflags && r.redflags.length ? `<div class="sub-h">出现以下情况请就医</div>
          <ul class="rf-list">${r.redflags.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
        <div class="dx-note">${escapeHtml(r.note)}</div>
      </div>`;
    });
  }

  html += `<div class="hint" style="border-top:1px dashed var(--line);padding-top:10px">
    ⚠️ 以上内容为公开资料整理的信息参考，不构成医疗建议；用药前请咨询医生或药师。紧急情况请拨打 120。</div>`;
  area.innerHTML = html;
}

/* ---------- 分析主流程 ---------- */
async function runAnalyze() {
  const text = $("#inputText").value.trim();
  const chips = $$("#quickChips .chip.on").map(b => b.dataset.kw);
  if (!text && !chips.length) {
    toast("请先输入症状描述或点选症状", "err");
    return;
  }

  const local = MedEngine.assemble(text, chips);
  lastResult = local;

  const settings = loadLLM();
  if (settings.enabled && settings.key) {
    toast("AI 增强分析中…");
    try {
      llmResult = await analyzeWithLLM(text, chips, settings);
      renderResults(llmResult, "本地引擎 + LLM 增强分析");
      lastResult = llmResult.local || local;
      MedKG.draw($("#kgCanvas"), lastResult);
      return;
    } catch (e) {
      toast("LLM 调用失败，已回退本地模式：" + e.message, "err");
    }
  }

  renderResults(local, "本地知识库（离线）");
  MedKG.draw($("#kgCanvas"), local);
}

/* ---------- LLM 增强（可选） ---------- */
function loadLLM() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem("medassist.llm") || "{}"); } catch (e) {}
  return {
    enabled: !!s.enabled, key: s.key || "",
    base: s.base || "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: s.model || "glm-4-flash"
  };
}

function saveLLM() {
  const enabled = $("#llmEnable").checked;
  const key = $("#llmKey").value.trim();
  const base = $("#llmBase").value.trim() || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const model = $("#llmModel").value.trim() || "glm-4-flash";
  localStorage.setItem("medassist.llm", JSON.stringify({ enabled, key, base, model }));
  renderLLMState();
  toast(enabled && key ? "AI 增强模式已开启" : "已保存（本地模式）");
}

function renderLLMState() {
  const s = loadLLM();
  $("#llmBadge").textContent = s.enabled && s.key ? "当前模式：LLM 增强 + 本地回退" : "当前模式：本地知识库（离线）";
  $("#llmState").textContent = s.enabled && s.key ? "✅ AI 增强已启用（" + s.model + "）" : "未启用 AI 增强（纯本地模式）";
}

async function analyzeWithLLM(text, chips, settings) {
  const system = `你是一个面向普通人的医学科普信息助手，严格遵守：
1. 不做诊断，只给"可能相关的常见情况"供就医参考；
2. 只推荐非处方药（OTC）的通用名并标注"按说明书"，处方药只提示需就医开具；
3. 检测到红旗急症信号（胸痛、偏瘫、呼吸困难、呕血、意识改变等）必须放最前并建议立即就医/拨打120；
4. 用简体中文，严格输出 JSON，不要多余文字。
JSON 格式：
{"redflags":[{"name":"","action":"","detail":""}],
"conditions":[{"name":"","dept":"","confidence":0,"evidence":[""],"otc":["通用名"],"rx_note":"","advice":[""],"note":""}],
"disclaimer":"本结果由AI生成，不构成医疗建议，请咨询医生。"}`;

  const user = `患者自述：${text || "（无文字）"}\n勾选症状：${chips.join("、") || "无"}\n请按系统规则输出 JSON。`;

  const resp = await fetch(settings.base, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + settings.key },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.3
    })
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const data = await resp.json();
  let content = data.choices[0].message.content.trim();
  content = content.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(content);

  const local = MedEngine.assemble(text, chips);

  const llmResults = parsed.conditions.slice(0, 4).map(c => ({
    name: c.name, dept: c.dept || "请咨询分诊台", pct: Math.min(97, c.confidence || 60),
    evidence: c.evidence || [],
    otc: (c.otc || []).map(n => ({
      name: n, otc: true, use: "AI 生成——请以药师/说明书核对为准",
      warn: ["AI 生成内容，务必与药师核对"]
    })),
    rx_note: c.rx_note || null,
    advice: c.advice || [],
    redflags: [], note: parsed.disclaimer || "AI 生成结果，不构成医疗建议。",
    tier: "direct"
  }));
  // 不足 3 种时用本地结果补齐相关方向
  const have = new Set(llmResults.map(r => r.name));
  for (const lr of local.results) {
    if (llmResults.length >= 3) break;
    if (have.has(lr.name)) continue;
    llmResults.push(Object.assign({}, lr, { tier: "ref", pct: 0 }));
    have.add(lr.name);
  }

  return {
    redflags: parsed.redflags && parsed.redflags.length ? parsed.redflags : local.redflags,
    results: llmResults,
    source: "llm", local
  };
}

/* ---------- 用药参考页 ---------- */
function renderDrugs(q) {
  const list = MedEngine.searchDrugs(q);
  $("#drugGrid").innerHTML = list.map(m => `<div class="drug-card">
    <h4>${escapeHtml(m.name)} <span class="cat">${escapeHtml(m.category)}</span></h4>
    <div class="row"><b>适应证：</b>${escapeHtml(m.use)}</div>
    <div class="row"><b>用法要点：</b>${escapeHtml(m.usage)}</div>
    <ul class="drug-warn">${m.warn.map(w => `<li>⚠ ${escapeHtml(w)}</li>`).join("")}</ul>
    <div class="drug-extra">💡 ${escapeHtml(m.extra)}</div>
  </div>`).join("") || `<div class="placeholder">没有匹配的药物。</div>`;

  $("#rxGrid").innerHTML = RX_CARDS.map(r => `<div class="rx-card">
    <h4>${escapeHtml(r.name)}</h4><span class="cat">${escapeHtml(r.category)}</span>
    <p>${escapeHtml(r.note)}</p>
  </div>`).join("");
}

/* ---------- 图谱统计页 ---------- */
function renderKgStats() {
  const symCount = new Set();
  DISEASES.forEach(d => Object.keys(d.kw).forEach(k => symCount.add(k)));
  const drugCount = DRUGS.filter(x => x.otc).length + DRUGS.filter(x => !x.otc).length;
  const depts = new Set(DISEASES.map(d => d.dept.split(" / ")[0]));
  const relations = DISEASES.reduce((a, d) => a + Object.keys(d.kw).length + d.otc.length + 1, 0);
  $("#kgStats").innerHTML = [
    ["病症", DISEASES.length], ["症状关键词", symCount.size],
    ["药物", DRUGS.length], ["科室", depts.size], ["关系边", relations]
  ].map(([l, v]) => `<div class="kg-stat"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#kgTableBody").innerHTML = [
    ["疾病 / 病症", DISEASES.length, "以病症为中心，含别名与就医科室"],
    ["症状关键词", symCount.size, "带权重，用于匹配评分"],
    ["药物", DRUGS.length, "OTC 信息卡 + 处方药科普卡"],
    ["科室", depts.size, "分诊指引"],
    ["关系边", relations, "症状→疾病→药物/科室 关联"],
  ].map(([a, b, c]) => `<tr><td><b>${a}</b></td><td>${b}</td><td>${c}</td></tr>`).join("");
}

/* ---------- 关于页 ---------- */
function renderAbout() {
  $("#redflagList").innerHTML = RED_FLAGS.map(f =>
    `<li><b>${escapeHtml(f.name)}</b> — ${escapeHtml(f.kw.slice(0, 4).join("、"))} 等关键词 → ${escapeHtml(f.action)}</li>`).join("");
  const s = loadLLM();
  $("#llmBase").value = s.base;
  $("#llmModel").value = s.model;
  $("#llmKey").value = s.key;
  $("#llmEnable").checked = s.enabled;
  renderLLMState();
}

/* ---------- 初始化 ---------- */
function init() {
  loadState();

  $("#mainTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) switchTab(btn.dataset.tab);
  });
  renderChips();
  $("#btnAnalyze").addEventListener("click", runAnalyze);
  $("#btnClear").addEventListener("click", () => {
    $("#inputText").value = "";
    $$("#quickChips .chip.on").forEach(b => b.classList.remove("on"));
    $("#redflagBanner").hidden = true;
    $("#resultArea").innerHTML = `<div class="placeholder">结果将显示在这里。</div>`;
    $("#resultMeta").textContent = "";
    lastResult = null;
    MedKG.draw($("#kgCanvas"), null);
  });
  $("#drugSearch").addEventListener("input", (e) => renderDrugs(e.target.value.trim()));
  $("#btnSaveLLM").addEventListener("click", saveLLM);

  $("#llmEnable").addEventListener("change", renderLLMState);

  renderKgStats();
  renderAbout();
  renderLLMState();
  renderDrugs("");
  switchTab("analyze");
}

/* 状态加载（localStorage 里的 LLM 设置） */
function loadState() {
  const s = loadLLM();
  $("#llmBase").value = s.base;
  $("#llmModel").value = s.model;
  $("#llmKey").value = s.key;
  $("#llmEnable").checked = s.enabled;
}

document.addEventListener("DOMContentLoaded", init);
