'use strict';

/* ============================================================
 * 医询 MedAssist · 本地匹配引擎
 * 思路参考 QASystemOnMedicalKG 的『问句解析 → 意图匹配 → 组装回答』,
 * 用加权关键词匹配替代 Neo4j 图查询, 实现零依赖离线运行。
 * ============================================================ */

const MedEngine = (() => {

  /* 分词: 中文按 2-gram + 词库词匹配, 英文/数字按词 */
  function segments(text) {
    const segs = new Set();
    const t = (text || "").toLowerCase();
    // 词库词与别名优先整体切分
    const vocab = new Set();
    DISEASES.forEach(d => {
      d.aliases.forEach(a => vocab.add(a));
      Object.keys(d.kw).forEach(k => vocab.add(k));
    });
    vocab.forEach(w => { if (t.includes(w)) segs.add(w); });
    // 2-gram 兜底（供关键词子串匹配）
    const cleaned = t.replace(/[，。！？、,.!?;；:\s]/g, " ");
    for (let i = 0; i < cleaned.length - 1; i++) {
      const g = cleaned.slice(i, i + 2).trim();
      if (g.length === 2 && !/\s/.test(g)) segs.add(g);
    }
    return segs;
  }

  /* 红旗检测 */
  function detectRedFlags(text, chips) {
    const hay = (text || "") + " " + (chips || []).join(" ");
    return RED_FLAGS.filter(f => f.kw.some(k => hay.includes(k)));
  }

  /* 病症匹配评分 */
  function match(text, chips) {
    const hay = (text || "") + " " + (chips || []).join(" ");
    if (!hay.trim()) return { redflags: [], results: [] };
    const redflags = detectRedFlags(text, chips);
    const segs = segments(text);
    const chipsStr = (chips || []).join("|");

    const results = DISEASES.map(dz => {
      let score = 0;
      const evidence = [];
      for (const [kw, w] of Object.entries(dz.kw)) {
        const inChips = chipsStr.includes(kw);
        const inText = hay.includes(kw) || segs.has(kw) ||
                       [...segs].some(s => (s.length >= 2 && kw.includes(s) && s === kw.slice(0, 2) && kw.length <= 3));
        if (inChips || inText) {
          score += w * (inChips ? 1.3 : 1);
          evidence.push(kw);
        }
      }
      let aliasHit = dz.aliases.some(a => hay.includes(a));
      if (aliasHit) { score += 5; evidence.push(dz.aliases.find(a => hay.includes(a))); }
      const total = Object.values(dz.kw).reduce((a, b) => a + b, 0) + 5;
      const pct = Math.min(97, Math.round((score / total) * 100));
      return { dz, score, pct, evidence };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

    return { redflags, results };
  }

  /* 组装单条结果 */
  function makeResult(dz, score, evidence, tier) {
    const total = Object.values(dz.kw).reduce((a, b) => a + b, 0) + 5;
    const pct = tier === "ref" ? 0 : Math.min(97, Math.round((score / total) * 100));
    return {
      id: dz.id, name: dz.name, dept: dz.dept, pct, tier: tier || "direct",
      evidence, otc: dz.otc.map(id => DRUGS.find(x => x.id === id)).filter(Boolean),
      rx_note: dz.rx_note || null, advice: dz.advice, redflags: dz.redflags, note: dz.note
    };
  }

  /* 补足相关方向 —— 保证结果至少关联 3 种病症 */
  function padRelated(res) {
    const need = 3 - res.results.length;
    if (need <= 0) return res;
    const have = new Set(res.results.map(r => r.id));
    const pool = [];
    const push = (id) => {
      if (pool.length >= need || have.has(id) || pool.some(p => p.id === id)) return;
      const dz = DISEASES.find(d => d.id === id);
      if (dz) { pool.push(makeResult(dz, 0, [], "ref")); have.add(id); }
    };
    // 1) 首位病症的相关方向
    if (res.results[0]) (RELATED[res.results[0].id] || []).forEach(push);
    // 2) 红旗急症的鉴别参考方向
    res.redflags.forEach(f => {
      const key = Object.keys(REDFLAG_RELATED).find(k => f.name.includes(k));
      if (key) REDFLAG_RELATED[key].forEach(push);
    });
    // 3) 同科室兜底
    if (pool.length < need && res.results[0]) {
      const dept0 = res.results[0].dept.split(" / ")[0];
      DISEASES.filter(d => !have.has(d.id) && d.dept.includes(dept0))
        .slice(0, need - pool.length).forEach(d => push(d.id));
    }
    res.results = res.results.concat(pool.slice(0, need));
    return res;
  }

  /* 组装结果数据（含药物卡与建议, 结果 ≥3 种病症） */
  function assemble(text, chips) {
    const { redflags, results } = match(text, chips);
    const res = {
      redflags,
      results: results.map(r => makeResult(r.dz, r.score, r.evidence, "direct"))
    };
    return padRelated(res);
  }

  /* 药物搜索 */
  function searchDrugs(q) {
    const t = (q || "").trim();
    if (!t) return DRUGS;
    return DRUGS.filter(x => (x.name + x.category + x.use).includes(t));
  }

  return { match, assemble, searchDrugs, detectRedFlags };
})();
