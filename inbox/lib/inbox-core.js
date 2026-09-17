// 경영 메모 인박스 — 저장 코어
//
// 원본(Vercel Blob 장부) + 미러(노션 DB). 봇 웹훅과 읽기 API가 이 파일을 공유한다.
// 이 파일은 Claude 세션을 거치지 않는다. 웹훅이 직접 불러서 직접 저장한다.

import { head, put } from "@vercel/blob";

export const INBOX_PATH = "inbox/entries.json";

/* ── 종류 (접두어는 있어도 없어도 된다) ───────────────────────────────
   이동 중에 매번 접두어를 붙여야 하는 봇은 두 달 안에 죽는다.
   접두어가 없으면 전부 "메모"로 저장하고, 있으면 인식만 한다.        */
const KINDS = [
  { key: "관찰",     label: "👀 관찰",     re: /^(관찰|현장)\s*[:：]\s*/ },
  { key: "이슈",     label: "⚠️ 이슈",     re: /^(이슈|문제|리스크)\s*[:：]\s*/ },
  { key: "아이디어", label: "💡 아이디어", re: /^(아이디어|아이디어어|기획)\s*[:：]\s*/ },
  { key: "결정",     label: "✅ 결정",     re: /^(결정|의사결정)\s*[:：]\s*/ },
  { key: "숫자",     label: "📊 숫자",     re: /^(숫자|실적|매출)\s*[:：]\s*/ },
  { key: "구성원",   label: "🙌 구성원",   re: /^(구성원|칭찬|피플)\s*[:：]\s*/ },
];
const DEFAULT_KIND = { key: "메모", label: "📝 메모" };

// 첫 글자 이모지는 온도(긴급도·감정)로 함께 기록한다.
const MOODS = ["🔥", "⚠️", "😤", "🤔", "😌", "✨", "👍", "😆", "🥲", "😴"];

// 계명 5 — 노션 select 라벨은 한글로. 영문("web"/"telegram")을 그대로 두면
// 브라우저 번역기가 web→편물, telegram→전보 로 오역해서 보여준다.
const SOURCE_LABEL = { telegram: "✈️ 텔레그램", web: "🖥️ 웹", api: "🔌 API" };

/** 던진 한 줄에서 종류·태그·온도를 뽑아낸다. 실패하지 않는다 — 최악이라도 본문은 남는다. */
export function parseMessage(raw) {
  let text = String(raw || "").trim();

  // ★ 순서가 중요하다. 이동 중에 제일 자연스럽게 나오는 형태가 "🔥 이슈: ..." 처럼
  //   급한 표시를 먼저 붙이는 것이다. 접두어를 먼저 찾으면 이 경우가 전부
  //   「메모」로 떨어져 분류가 통째로 죽는다. 그래서 온도 → 접두어 → 온도 순으로 본다.
  let mood = "";
  const takeMood = () => {
    if (mood) return;
    for (const m of MOODS) {
      if (text.startsWith(m)) { mood = m; text = text.slice(m.length).trim(); return; }
    }
  };

  takeMood();

  let kind = DEFAULT_KIND;
  for (const k of KINDS) {
    if (k.re.test(text)) { kind = k; text = text.replace(k.re, "").trim(); break; }
  }

  takeMood(); // "이슈: 🔥 ..." 처럼 접두어 뒤에 붙인 경우

  // 해시태그는 본문에서 지우지 않는다 — 읽을 때 문맥이 사라지기 때문.
  const tags = [...new Set(
    [...text.matchAll(/#([\p{L}\p{N}_]{1,30})/gu)].map((m) => m[1])
  )].slice(0, 10);

  return { text: text.trim(), kind: { key: kind.key, label: kind.label }, mood, tags };
}

/* ── 장부 읽기 ────────────────────────────────────────────────────────
   계명 9 — list() 를 쓰지 않는다. Vercel Blob의 "고급 작업"은 무료 플랜
   월 2,000회이고, 넘기면 계정의 저장소 전체가 차단된다(다른 서비스까지 멈춘다).
   addRandomSuffix:false 로 저장하므로 URL이 결정적이다 →
   BLOB_BASE_URL 을 넣어두면 고급 작업 호출 0회로 읽는다.               */
let cachedUrl = null;

async function resolveLedgerUrl() {
  if (cachedUrl) return cachedUrl;
  const base = process.env.BLOB_BASE_URL;
  if (base) {
    cachedUrl = `${base.replace(/\/+$/, "")}/${INBOX_PATH}`;
    return cachedUrl;
  }
  try {
    const meta = await head(INBOX_PATH); // 존재 확인만 필요할 때는 head(). list() 금지.
    cachedUrl = meta.url;
    return cachedUrl;
  } catch {
    return null; // 장부가 아직 없다 = 첫 기록
  }
}

/**
 * 장부 전체를 읽는다.
 *
 * ★ 여기가 이 파일에서 제일 위험한 함수다. 읽기가 실패했는데 빈 배열을 돌려주면
 *   바로 뒤의 put() 이 장부 전체를 1건으로 덮어써 **그동안 쌓은 기록이 전부 날아간다.**
 *   그래서 "없음"과 "못 읽음"을 반드시 구분하고, 못 읽었으면 던진다.
 *   저장을 한 번 실패하는 건 회복되지만, 장부가 날아가는 건 회복되지 않는다.
 */
export async function loadEntries({ strict = true } = {}) {
  const url = await resolveLedgerUrl();
  if (!url) return []; // 장부 없음

  let res;
  try {
    res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  } catch (e) {
    if (strict) throw new Error(`장부를 읽지 못했습니다 (네트워크): ${e.message}`);
    return [];
  }
  if (res.status === 404) return []; // 장부 없음
  if (!res.ok) {
    if (strict) throw new Error(`장부를 읽지 못했습니다 (HTTP ${res.status})`);
    return [];
  }

  const body = await res.text();
  try {
    const data = JSON.parse(body);
    if (!Array.isArray(data)) throw new Error("배열이 아님");
    return data;
  } catch (e) {
    if (strict) throw new Error(`장부가 깨졌습니다: ${e.message}`);
    return [];
  }
}

/* ── 노션 미러 ────────────────────────────────────────────────────── */
export async function mirrorToNotion(entry) {
  const token = process.env.NOTION_TOKEN;
  const db = process.env.NOTION_DB;
  if (!token || !db) return false;

  const preview = entry.text.slice(0, 40) + (entry.text.length > 40 ? "…" : "");
  const props = {
    "제목": { title: [{ text: { content: preview } }] },
    "날짜": { date: { start: entry.date } },
    "종류": { select: { name: entry.kindLabel } },
    "출처": { select: { name: SOURCE_LABEL[entry.source] || SOURCE_LABEL.web } },
  };
  if (entry.tags?.length) {
    props["태그"] = { multi_select: entry.tags.map((t) => ({ name: t })) };
  }
  if (entry.mood) props["온도"] = { select: { name: entry.mood } };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: db },
      properties: props,
      // 본문은 블록으로. 제목은 40자로 잘리지만 원문은 여기 통째로 남는다.
      children: [{
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: entry.text.slice(0, 2000) } }] },
      }],
    }),
  });

  if (!res.ok) {
    // 404 는 거의 항상 "DB에 integration 연결을 안 함"이다. 로그에 원인을 남긴다.
    const detail = await res.text().catch(() => "");
    console.error(`[notion] ${res.status} ${detail.slice(0, 300)}`);
    return false;
  }
  return true;
}

/* ── 저장 ─────────────────────────────────────────────────────────── */
export async function saveEntry(raw, source = "telegram") {
  const parsed = parseMessage(raw);
  if (!parsed.text) throw new Error("본문이 비어 있습니다");

  const entries = await loadEntries({ strict: true }); // 못 읽으면 여기서 멈춘다 (장부 보호)

  // 계명 6 — 서버는 UTC다. KST 보정 없이 날짜를 찍으면 밤에 쓴 글이 전날로 들어간다.
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: kst.toISOString().slice(0, 10),
    time: kst.toISOString().slice(11, 16),
    source,
    kind: parsed.kind.key,
    kindLabel: parsed.kind.label,
    mood: parsed.mood,
    tags: parsed.tags,
    text: parsed.text,
  };

  entries.push(entry);
  await put(INBOX_PATH, JSON.stringify(entries, null, 1), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false, // ★ 없으면 저장할 때마다 파일이 새로 생겨 누적이 깨진다
    allowOverwrite: true,
    cacheControlMaxAge: 0,  // ★ 없으면 방금 저장한 게 안 보인다
  });

  // 계명 4 — 미러 실패가 원본 저장을 막지 않는다. 노션이 죽어도 글은 남아야 한다.
  let notion = false;
  try { notion = await mirrorToNotion(entry); } catch (e) { console.error("[notion]", e.message); }

  return { count: entries.length, entry, notion };
}

/** /통계 용 — 최근 기록의 분포를 센다. */
export function summarize(entries, days = 7) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const since = new Date(kst.getTime() - days * 86400000).toISOString().slice(0, 10);
  const recent = entries.filter((e) => e.date >= since);
  const byKind = {};
  for (const e of recent) byKind[e.kindLabel || "📝 메모"] = (byKind[e.kindLabel || "📝 메모"] || 0) + 1;
  const byTag = {};
  for (const e of recent) for (const t of e.tags || []) byTag[t] = (byTag[t] || 0) + 1;
  return { total: entries.length, recent: recent.length, days, byKind, byTag };
}
