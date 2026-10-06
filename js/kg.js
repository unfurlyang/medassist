'use strict';

/* ============================================================
 * 医询 MedAssist · 知识图谱可视化（canvas 放射布局）
 * 症状 — 疾病 — 药物/科室 关系图, 参考 QASystemOnMedicalKG 的
 * 『疾病为中心的多实体关联』数据结构, 纯 canvas 实现。
 * ============================================================ */

const MedKG = (() => {

  function draw(canvas, result) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 420;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!result || !result.results || !result.results.length) {
      ctx.fillStyle = "#9aa7a3";
      ctx.font = "14px 'Microsoft YaHei'";
      ctx.textAlign = "center";
      ctx.fillText("先在上方完成一次分析，图谱将展示 症状—疾病—药物—科室 的关联", cssW / 2, cssH / 2);
      return;
    }

    const top = result.results[0];
    const cx = cssW / 2, cy = cssH / 2;
    const nodes = [];
    const edges = [];

    // 中心: 疾病
    nodes.push({ x: cx, y: cy, label: top.name, type: "disease", r: 34 });

    // 左弧: 症状（匹配证据, 最多 6）
    const syms = top.evidence.slice(0, 6);
    syms.forEach((s, i) => {
      const ang = Math.PI * 0.62 + (Math.PI * 0.76) * (syms.length === 1 ? 0.5 : i / (syms.length - 1));
      const x = cx + Math.cos(ang) * Math.min(cssW * 0.36, 300);
      const y = cy + Math.sin(ang) * Math.min(cssH * 0.36, 150);
      nodes.push({ x, y, label: s, type: "symptom", r: 8 });
      edges.push([cx, cy, x, y, "symptom"]);
    });

    // 右弧: 药物（最多 4）
    top.otc.slice(0, 4).forEach((m, i) => {
      const ang = -Math.PI * 0.10 - Math.PI * 0.5 * (top.otc.length === 1 ? 0.5 : i / Math.max(1, top.otc.length - 1));
      const x = cx + Math.cos(ang) * Math.min(cssW * 0.38, 320);
      const y = cy + Math.sin(ang) * Math.min(cssH * 0.34, 140);
      nodes.push({ x, y, label: m.name.split("（")[0], type: "drug", r: 10 });
      edges.push([cx, cy, x, y, "drug"]);
    });

    // 下方: 科室
    const dept = { x: cx, y: Math.min(cssH - 46, cy + Math.min(cssH * 0.33, 150)), label: top.dept, type: "dept", r: 12 };
    nodes.push(dept);
    edges.push([cx, cy, dept.x, dept.y, "dept"]);

    // 边
    edges.forEach(([x1, y1, x2, y2, type]) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = type === "symptom" ? "rgba(14,124,134,.35)"
                      : type === "drug" ? "rgba(214,69,69,.35)"
                      : "rgba(120,130,140,.35)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });

    // 节点
    nodes.forEach(n => {
      ctx.beginPath();
      if (n.type === "disease") {
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = "#0e7c86";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "600 13px 'Microsoft YaHei'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.label.slice(0, 4), n.x, n.y);
        ctx.fillStyle = "#0e7c86";
        ctx.font = "600 12px 'Microsoft YaHei'";
        ctx.fillText(n.label, n.x, n.y + n.r + 16);
      } else if (n.type === "symptom") {
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = "#0e7c86";
        ctx.fill();
        ctx.fillStyle = "#39464a";
        ctx.font = "12px 'Microsoft YaHei'";
        ctx.textAlign = "center";
        ctx.fillText(n.label, n.x, n.y - n.r - 8);
      } else if (n.type === "drug") {
        ctx.beginPath();
        const s = n.r + 4;
        ctx.moveTo(n.x, n.y - s); ctx.lineTo(n.x + s, n.y);
        ctx.lineTo(n.x, n.y + s); ctx.lineTo(n.x - s, n.y);
        ctx.closePath();
        ctx.fillStyle = "#d64545";
        ctx.fill();
        ctx.fillStyle = "#39464a";
        ctx.font = "12px 'Microsoft YaHei'";
        ctx.textAlign = "center";
        ctx.fillText(n.label.slice(0, 7), n.x, n.y - s - 8);
      } else {
        const w = ctx.measureText(n.label).width + 22;
        ctx.fillStyle = "#7c8a92";
        roundRect(ctx, n.x - w / 2, n.y - 15, w, 30, 6);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "600 12px 'Microsoft YaHei'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.label, n.x, n.y + 1);
      }
    });

    // 图例
    const legend = [["症状", "#0e7c86"], ["药物", "#d64545"], ["科室", "#7c8a92"]];
    legend.forEach(([lab, col], i) => {
      ctx.beginPath();
      ctx.arc(cssW - 110, 24 + i * 20, 5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.fillStyle = "#6b7a80";
      ctx.font = "12px 'Microsoft YaHei'";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(lab, cssW - 98, 24 + i * 20);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { draw };
})();
