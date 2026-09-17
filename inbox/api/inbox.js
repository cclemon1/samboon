// 회수(읽기) API — 인박스는 비워야 인박스다.
//
// 쌓기만 하면 6개월 뒤 "뭔가 많이 쌓였는데 못 쓰겠다"가 된다.
// 이 엔드포인트가 있어야 Claude·노션·스프레드시트로 통째로 꺼내 쓸 수 있다.
//
//   GET /api/inbox?key=...&from=2026-09-01&to=2026-09-30&kind=이슈&tag=브라운&q=도쿄
//   GET /api/inbox?key=...&format=md        ← 바로 읽을 수 있는 마크다운 정리본

import { loadEntries } from "../lib/inbox-core.js";

export default async function handler(req, res) {
  const key = req.query?.key || req.headers["x-inbox-key"] || "";
  const expected = process.env.INBOX_READ_KEY;
  // 키를 설정하지 않았으면 열지 않는다 — 실수로 전체 공개되는 쪽이 더 위험하다.
  if (!expected || key !== expected) return res.status(401).json({ error: "unauthorized" });

  let entries;
  try {
    entries = await loadEntries({ strict: true });
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  const { from, to, kind, tag, q, limit } = req.query || {};
  let out = entries;
  if (from) out = out.filter((e) => e.date >= from);
  if (to) out = out.filter((e) => e.date <= to);
  if (kind) out = out.filter((e) => e.kind === kind);
  if (tag) out = out.filter((e) => (e.tags || []).includes(tag));
  if (q) {
    const needle = String(q).toLowerCase();
    out = out.filter((e) => e.text.toLowerCase().includes(needle));
  }

  out = out.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const n = Math.min(Number(limit) || 500, 2000);
  const sliced = out.slice(0, n);

  res.setHeader("Cache-Control", "no-store");

  if (req.query?.format === "md") {
    const lines = [`# 인박스 회수 — ${sliced.length}건 (누적 ${entries.length}건)`, ""];
    let day = "";
    for (const e of sliced) {
      if (e.date !== day) { day = e.date; lines.push("", `## ${day}`, ""); }
      const tags = (e.tags || []).map((t) => "#" + t).join(" ");
      lines.push(`- \`${e.time}\` ${e.kindLabel || "📝 메모"}${e.mood ? " " + e.mood : ""} ${e.text}${tags ? "  ` " + tags + "`" : ""}`);
    }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    return res.status(200).send(lines.join("\n"));
  }

  return res.status(200).json({
    total: entries.length,
    matched: out.length,
    returned: sliced.length,
    entries: sliced,
  });
}
