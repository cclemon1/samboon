// @vercel/blob 대체 — 실제 패키지는 재시도·백오프가 있어 시험을 멈춰 세운다.
const S = (globalThis.__blob ??= { data: null, puts: 0, readable: true });

export async function put(pathname, body, opts) {
  S.puts++;
  if (opts?.addRandomSuffix !== false) throw new Error("addRandomSuffix:false 가 아니면 누적이 깨진다");
  if (opts?.allowOverwrite !== true) throw new Error("allowOverwrite 가 필요하다");
  S.data = body;
  return { url: `${process.env.BLOB_BASE_URL}/${pathname}`, pathname };
}

export async function head(pathname) {
  if (S.data === null) throw new Error("not found");
  return { url: `${process.env.BLOB_BASE_URL}/${pathname}`, pathname };
}

export async function list() { throw new Error("계명 9 — list() 를 호출하면 안 된다"); }
