// 한 줄 파서 시험 — 접두어·이모지·해시태그 인식.
// 이동 중에 실제로 나오는 형태들을 그대로 넣는다.
import { parseMessage, summarize } from "../lib/inbox-core.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};
const p = (s) => { const r = parseMessage(s); return [r.kind.key, r.mood, r.tags, r.text]; };

console.log("\n[접두어 없이 던지기] — 이게 기본이고, 가장 오래 간다");
eq("아무 말이나", p("도쿄 하라주쿠 매장 주말 오후 대기줄 30분"),
   ["메모", "", [], "도쿄 하라주쿠 매장 주말 오후 대기줄 30분"]);
eq("해시태그만", p("에디슨마마 릴스 반응 좋다 #에디슨마마 #SNS"),
   ["메모", "", ["에디슨마마", "SNS"], "에디슨마마 릴스 반응 좋다 #에디슨마마 #SNS"]);

console.log("\n[접두어를 쓸 때]");
eq("관찰", p("관찰: 대기줄이 길다"), ["관찰", "", [], "대기줄이 길다"]);
eq("이슈", p("이슈: 라이센스 갱신 정체 #BIZ2"), ["이슈", "", ["BIZ2"], "라이센스 갱신 정체 #BIZ2"]);
eq("아이디어", p("아이디어: 전/후 3초 컷"), ["아이디어", "", [], "전/후 3초 컷"]);
eq("결정", p("결정: 4분기 오프라인 우선"), ["결정", "", [], "4분기 오프라인 우선"]);
eq("숫자", p("숫자: 온라인 누적 4.2억엔"), ["숫자", "", [], "온라인 누적 4.2억엔"]);
eq("구성원", p("구성원: 준비도가 올라왔다"), ["구성원", "", [], "준비도가 올라왔다"]);
eq("동의어(현장)", p("현장: 재고가 비었다"), ["관찰", "", [], "재고가 비었다"]);
eq("전각 콜론", p("관찰：전각도 인식"), ["관찰", "", [], "전각도 인식"]);
eq("콜론 뒤 공백 여러 개", p("이슈:   공백 여러 개"), ["이슈", "", [], "공백 여러 개"]);

console.log("\n[온도 이모지] — 급한 걸 먼저 붙이는 게 사람의 실제 습관이다");
eq("이모지 + 접두어", p("🔥 이슈: 당장 봐야 함"), ["이슈", "🔥", [], "당장 봐야 함"]);
eq("접두어 + 이모지", p("이슈: 🔥 당장 봐야 함"), ["이슈", "🔥", [], "당장 봐야 함"]);
eq("이모지만", p("🤔 이건 좀 더 봐야 한다"), ["메모", "🤔", [], "이건 좀 더 봐야 한다"]);
eq("이모지 두 개면 앞 하나만", p("🔥🔥 급함"), ["메모", "🔥", [], "🔥 급함"]);

console.log("\n[깨지지 않아야 하는 입력]");
eq("빈 문자열", p(""), ["메모", "", [], ""]);
eq("null", p(null), ["메모", "", [], ""]);
eq("undefined", p(undefined), ["메모", "", [], ""]);
eq("접두어만", p("이슈:"), ["이슈", "", [], ""]);
eq("콜론 없는 접두어는 본문", p("이슈가 하나 있다"), ["메모", "", [], "이슈가 하나 있다"]);
eq("중복 태그는 한 번만", p("#브라운 #브라운 #코니"), ["메모", "", ["브라운", "코니"], "#브라운 #브라운 #코니"]);
{
  const r = parseMessage("#" + "가".repeat(40));
  eq("과도하게 긴 태그는 30자에서 끊는다", r.tags[0].length, 30);
}
{
  const r = parseMessage(Array.from({ length: 20 }, (_, i) => `#t${i}`).join(" "));
  eq("태그는 최대 10개", r.tags.length, 10);
}

console.log("\n[통계]");
{
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const old = new Date(Date.now() + 9 * 3600 * 1000 - 40 * 86400000).toISOString().slice(0, 10);
  const s = summarize([
    { date: today, time: "10:00", kindLabel: "⚠️ 이슈", tags: ["BIZ2"] },
    { date: today, time: "11:00", kindLabel: "👀 관찰", tags: ["브라운", "오프라인"] },
    { date: old, time: "09:00", kindLabel: "📝 메모", tags: ["브라운"] },
  ], 7);
  eq("누적은 전체", s.total, 3);
  eq("최근 7일만 센다", s.recent, 2);
  eq("종류별 집계", s.byKind, { "⚠️ 이슈": 1, "👀 관찰": 1 });
  eq("태그별 집계", s.byTag, { BIZ2: 1, 브라운: 1, 오프라인: 1 });
}

console.log(`\n───────────  통과 ${pass} · 실패 ${fail}  ───────────`);
process.exit(fail ? 1 : 0);
