// 텔레그램 → 인박스 직통 웹훅.
//
// Claude 세션을 거치지 않는다. 그래서 새벽 3시에 던져도, PC가 꺼져 있어도,
// 세션이 끊겨 있어도 저장된다.

import { loadEntries, saveEntry, summarize } from "../lib/inbox-core.js";

const HELP =
  "📥 경영 메모 인박스예요.\n\n" +
  "아무 말이나 보내면 그대로 저장됩니다. 제목도, 폴더도 정하지 않습니다.\n\n" +
  "— 접두어는 *써도 되고 안 써도 됩니다* —\n" +
  "관찰: / 이슈: / 아이디어: / 결정: / 숫자: / 구성원:\n" +
  "→ 안 붙이면 전부 「메모」로 저장됩니다.\n\n" +
  "— 해시태그로 나중에 꺼내 쓰기 —\n" +
  "#브라운 #BIZ1 #오프라인 #에디슨마마 처럼 붙이면 태그로 함께 기록돼요.\n\n" +
  "— 첫 글자 이모지는 온도로 —\n" +
  "🔥 급함 / ⚠️ 위험 / 🤔 생각 / 👍 좋음\n\n" +
  "명령: 핑(연결 확인) · /통계 · /도움";

async function send(chatId, text, replyTo) {
  const tok = process.env.BOT_TOKEN;
  if (!tok) return;
  try {
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      }),
    });
  } catch (e) {
    console.error("[send]", e.message);
  }
}

export default async function handler(req, res) {
  // ★ 계명 1 — 항상 200으로 끝낸다.
  //   에러를 돌려주면 텔레그램이 같은 메시지를 끝없이 재전송한다.
  if (req.method !== "POST") return res.status(200).send("inbox webhook alive");

  // ★ 계명 2 관문 1 — 웹훅 시크릿 헤더.
  const secret = req.headers["x-telegram-bot-api-secret-token"] || "";
  if (!process.env.TG_WEBHOOK_SECRET || secret !== process.env.TG_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const update = req.body || {};
  // 편집한 메시지도 받는다 — 이동 중에 오타를 고치는 일이 실제로 잦다.
  const msg = update.message || update.edited_message;
  const chatId = msg && msg.chat && String(msg.chat.id);

  // ★ 계명 2 관문 2 — 내 chat_id 만 처리. 봇 아이디는 공개라 누구나 말을 걸 수 있다.
  if (!msg || !chatId || chatId !== process.env.MY_CHAT_ID) {
    return res.status(200).json({ ok: true });
  }

  const text = (msg.text || "").trim();

  if (!text) {
    await send(chatId, "지금은 글(텍스트)만 저장할 수 있어요 ✍️", msg.message_id);
    return res.status(200).json({ ok: true });
  }

  if (text === "/start" || text === "/도움" || text === "/help") {
    await send(chatId, HELP);
    return res.status(200).json({ ok: true });
  }

  // ★ 계명: 핑-퐁을 넣어둔다. "이거 살아있나?" 를 5초 만에 판정하게 해준다.
  if (text === "핑" || text.toLowerCase() === "ping") {
    await send(chatId, "퐁! 인박스 직통 연결 정상이에요 📥", msg.message_id);
    return res.status(200).json({ ok: true });
  }

  if (text === "/통계" || text === "/stats") {
    try {
      const s = summarize(await loadEntries({ strict: true }), 7);
      const kinds = Object.entries(s.byKind).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `  ${k} ${v}`).join("\n") || "  (없음)";
      const tags = Object.entries(s.byTag).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `#${k}(${v})`).join(" ") || "(없음)";
      await send(chatId,
        `📊 누적 ${s.total}건 · 최근 ${s.days}일 ${s.recent}건\n\n${kinds}\n\n태그: ${tags}`,
        msg.message_id);
    } catch (e) {
      await send(chatId, `⚠️ 장부를 읽지 못했어요: ${e.message}`, msg.message_id);
    }
    return res.status(200).json({ ok: true });
  }

  if (text.length > 5000) {
    await send(chatId, "5000자 이하로 나눠서 보내주세요 🙏", msg.message_id);
    return res.status(200).json({ ok: true });
  }

  try {
    const r = await saveEntry(text, "telegram");
    const tagPart = r.entry.tags.length ? ` ${r.entry.tags.map((t) => "#" + t).join(" ")}` : "";
    // ★ 계명 10 — 번호를 넣는다. 쌓이는 감각이 이 봇의 수명을 결정한다.
    await send(chatId,
      `📥 ${r.count}번째 기록 저장! ${r.entry.kindLabel}${r.entry.mood ? " " + r.entry.mood : ""}${tagPart}` +
      (r.notion ? "\n노션에도 적어뒀어요 ✓" : "\n(노션 미러는 실패 — 장부에는 남았습니다)"),
      msg.message_id);
  } catch (e) {
    console.error("[save]", e.message);
    // 장부를 읽지 못한 경우다. 덮어쓰지 않고 멈췄으니 기존 기록은 안전하다.
    await send(chatId,
      "⚠️ 저장하지 못했어요. 기존 기록은 그대로 안전합니다.\n잠시 후 다시 보내주시면 꼭 저장할게요.",
      msg.message_id);
  }

  return res.status(200).json({ ok: true });
}
