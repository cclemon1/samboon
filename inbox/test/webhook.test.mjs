// 웹훅 통합 시험 — 텔레그램/노션/Blob 을 전부 가짜로 세운다.
const BASE = "https://fake.public.blob.vercel-storage.com";

process.env.BOT_TOKEN = "111:FAKE";
process.env.MY_CHAT_ID = "999";
process.env.TG_WEBHOOK_SECRET = "s3cret";
process.env.NOTION_TOKEN = "ntn_fake";
process.env.NOTION_DB = "0".repeat(32);
process.env.BLOB_BASE_URL = BASE;
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_FAKE_abc";
process.env.INBOX_READ_KEY = "readkey";

const S = (globalThis.__blob ??= { data: null, puts: 0, readable: true });
let notionOk = true;
let sent = [];

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  if (u.includes("api.telegram.org") && u.includes("sendMessage")) {
    sent.push(JSON.parse(opt.body).text);
    return J({ ok: true });
  }
  if (u.includes("api.notion.com")) return notionOk ? J({ id: "page" }) : J({ message: "not found" }, 404);
  if (u.startsWith(BASE)) {                              // 장부 읽기
    if (!S.readable) return new Response("boom", { status: 500 });
    if (S.data === null) return new Response("", { status: 404 });
    return new Response(S.data, { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("예상치 못한 fetch: " + u);
};

const { default: telegram } = await import("../api/telegram.js");
const { default: inboxApi } = await import("../api/inbox.js");

function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const hit = async (body, { secret = "s3cret", method = "POST" } = {}) => {
  sent = [];
  const res = mkRes();
  await telegram({ method, headers: { "x-telegram-bot-api-secret-token": secret }, body }, res);
  return res;
};
const msg = (text, chat = 999) => ({ message: { message_id: 1, chat: { id: chat }, text } });

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`); }
};

console.log("\n[관문] 계명 2 — 두 개 다 걸려 있는가");
check("시크릿 불일치 → 401", (await hit(msg("아무거나"), { secret: "wrong" })).code === 401);
check("시크릿 없음 → 401", (await hit(msg("아무거나"), { secret: "" })).code === 401);
{
  const r = await hit(msg("남이 보낸 말", 12345));
  check("남의 chat_id → 200이지만 무시", r.code === 200 && sent.length === 0);
}
check("GET → 200 (재전송 방지)", (await hit(null, { method: "GET" })).code === 200);

console.log("\n[명령] 핑-퐁 · 도움");
{ const r = await hit(msg("핑")); check("핑 → 퐁", r.code === 200 && /퐁/.test(sent[0] || "")); }
{ await hit(msg("ping")); check("ping(영문) → 퐁", /퐁/.test(sent[0] || "")); }
{ await hit(msg("/start")); check("/start → 안내문", /인박스/.test(sent[0] || "")); }

console.log("\n[저장] 누적 번호와 노션 미러");
{
  await hit(msg("도쿄 하라주쿠 대기줄 30분 #브라운 #오프라인"));
  check("1번째 저장 회신", /1번째 기록 저장/.test(sent[0] || ""), sent[0]);
  check("종류=메모 표시", /📝 메모/.test(sent[0] || ""), sent[0]);
  check("태그 회신에 포함", /#브라운/.test(sent[0] || ""), sent[0]);
  check("노션 확인 표시", /노션에도 적어뒀어요/.test(sent[0] || ""), sent[0]);
}
{
  await hit(msg("🔥 이슈: BIZ2 라이센스 정체 #BIZ2"));
  check("2번째 — 누적됨", /2번째 기록 저장/.test(sent[0] || ""), sent[0]);
  check("이모지+접두어 동시 인식", /⚠️ 이슈/.test(sent[0] || "") && /🔥/.test(sent[0] || ""), sent[0]);
}
{
  const e = JSON.parse(S.data);
  check("장부에 2건", e.length === 2, `실제 ${e.length}`);
  check("KST 날짜", /^\d{4}-\d{2}-\d{2}$/.test(e[0].date), e[0].date);
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  check("KST 보정이 맞음", e[0].date === kstToday, `${e[0].date} vs ${kstToday}`);
  check("본문에 해시태그 보존", e[0].text.includes("#브라운"));
}

console.log("\n[미러 실패] 계명 4 — 노션이 죽어도 글은 남는가");
{
  notionOk = false;
  await hit(msg("노션 죽은 상태에서 던진 메모"));
  check("저장은 성공", /3번째 기록 저장/.test(sent[0] || ""), sent[0]);
  check("미러 실패를 숨기지 않음", /노션 미러는 실패/.test(sent[0] || ""), sent[0]);
  check("장부에는 3건", JSON.parse(S.data).length === 3);
  notionOk = true;
}

console.log("\n[장부 보호] ★ 읽기가 실패했을 때 덮어쓰지 않는가");
{
  const before = S.data, putsBefore = S.puts;
  S.readable = false;
  const r = await hit(msg("장부를 못 읽는 상황에서 던진 메모"));
  check("200 반환 (무한 재전송 방지)", r.code === 200);
  check("사용자에게 실패를 알림", /저장하지 못했어요/.test(sent[0] || ""), sent[0]);
  check("put() 을 아예 호출하지 않음", S.puts === putsBefore, `puts ${putsBefore}→${S.puts}`);
  check("기존 장부 그대로", S.data === before);
  S.readable = true;
}

console.log("\n[통계]");
{ await hit(msg("/통계")); check("/통계 회신", /누적 3건/.test(sent[0] || ""), sent[0]); }

console.log("\n[회수 API] 인박스는 비워야 인박스다");
{
  const mk = (q) => { const res = mkRes(); return [{ query: q, headers: {} }, res]; };
  let [rq, rs] = mk({}); await inboxApi(rq, rs);
  check("키 없이 → 401", rs.code === 401);
  [rq, rs] = mk({ key: "틀린키" }); await inboxApi(rq, rs);
  check("틀린 키 → 401", rs.code === 401);
  [rq, rs] = mk({ key: "readkey" }); await inboxApi(rq, rs);
  check("올바른 키 → 3건", rs.code === 200 && rs.body.total === 3, JSON.stringify(rs.body?.total));
  [rq, rs] = mk({ key: "readkey", kind: "이슈" }); await inboxApi(rq, rs);
  check("종류 필터", rs.body.matched === 1, `matched ${rs.body.matched}`);
  [rq, rs] = mk({ key: "readkey", tag: "브라운" }); await inboxApi(rq, rs);
  check("태그 필터", rs.body.matched === 1, `matched ${rs.body.matched}`);
  [rq, rs] = mk({ key: "readkey", q: "하라주쿠" }); await inboxApi(rq, rs);
  check("본문 검색", rs.body.matched === 1, `matched ${rs.body.matched}`);
  [rq, rs] = mk({ key: "readkey", format: "md" }); await inboxApi(rq, rs);
  check("마크다운 정리본", typeof rs.body === "string" && rs.body.includes("# 인박스 회수"));
}

console.log(`\n───────────  통과 ${pass} · 실패 ${fail}  ───────────`);
process.exit(fail ? 1 : 0);
