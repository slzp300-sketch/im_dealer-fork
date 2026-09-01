// 캐피탈사별 접속 설정 (비밀 아님 — 로그인 URL·어댑터·헤드풀 여부).
// 로그인 ID/PW 는 여기 두지 않는다. 각 관리자가 가져오기 할 때마다 직접 입력한다.
export interface CapitalConnection {
  adapter: string; // 워커 어댑터 코드 (scripts/scraper-worker/adapters/registry.ts)
  loginUrl: string;
  requiresHuman: boolean; // 휴대폰인증·키보드보안 등 사람 개입 필요 → 헤드풀
  /** 어댑터가 트림 지정 수집(scrapeTrim)을 지원하지 않아 카탈로그 수집만 가능한 곳. */
  catalogOnly?: boolean;
}

// 캐피탈사명(부분일치) → 접속 설정. 캐피탈사가 늘면 여기 추가한다.
const CONNECTIONS: { match: (name: string) => boolean; conn: CapitalConnection }[] = [
  {
    match: (n) => n.includes("오릭스") || n.toUpperCase().includes("ORIX"),
    conn: { adapter: "ORIX", loginUrl: "https://nf.orix.co.kr/com/login.frm", requiresHuman: false },
  },
  {
    // 우리금융캐피탈 — nProtect 키패드(자동 로그인 불가) → 헤드풀 사람 로그인.
    match: (n) => n.includes("우리금융") || n.toUpperCase().includes("WOORIFC"),
    conn: { adapter: "WOORIFC", loginUrl: "https://wonclick.woorifcapital.com", requiresHuman: true },
  },
  {
    // 신한카드 — nProtect 키패드 → 헤드풀 사람 로그인.
    // 어댑터가 카탈로그 수집 전용(scrapeTrim 미지원) — 트림 지정/일괄 수집을 걸면 빈 결과만 나온다.
    match: (n) => n.includes("신한"),
    conn: { adapter: "SHINHAN", loginUrl: "https://mycar.shinhancard.com/adp/ADPFM860N/ADPFM860R20.shc", requiresHuman: true, catalogOnly: true },
  },
  {
    // JB우리캐피탈 — RaonSecure 키패드 + SMS 2차인증 → 헤드풀 사람 로그인.
    match: (n) => n.includes("JB") || n.includes("전북") || n.includes("우리캐피탈"),
    conn: { adapter: "JBWOORI", loginUrl: "https://emp.wooricap.com/sale/log/mdSaleLog0010.do", requiresHuman: true },
  },
  {
    // BNK캐피탈 — 파트너 포털 키보드보안(TouchEn/raon) → 헤드풀 사람 로그인.
    // 로그인 후 '견적내기'로 견적엔진(aict) 진입까지 사람이 수행하면 token 을 낚아채 API 리플레이.
    // 어댑터가 카탈로그 수집 전용(scrapeTrim 미지원).
    match: (n) => n.includes("BNK") || n.includes("비엔케이") || n.includes("부산") || n.includes("경남"),
    conn: { adapter: "BNK", loginUrl: "https://web.bnkcapital.co.kr/view/prtn/logn/PrtnLogn010M01", requiresHuman: true, catalogOnly: true },
  },
];

/** 캐피탈사명으로 접속 설정을 찾는다. 지원하지 않는 곳이면 null. */
export function resolveCapitalConnection(financeCompanyName: string): CapitalConnection | null {
  const hit = CONNECTIONS.find((c) => c.match(financeCompanyName));
  return hit ? hit.conn : null;
}
