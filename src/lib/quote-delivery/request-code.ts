// 고객이 카카오 채널 대화창에 붙여넣는 요청번호.
//
// 카카오 대화창은 메시지 프리필을 지원하지 않아, 고객이 문구를 붙여넣어 보내야
// 한다. 그 메시지를 채널톡 웹훅으로 받아 어떤 견적서를 보낼지 찾는 유일한 단서가
// 이 번호다. 붙여넣기가 막혀 직접 입력하는 경우가 있으므로 짧고, 헷갈리는 글자
// (0/O, 1/I/L)를 뺀 알파벳을 쓴다.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REQUEST_CODE_LENGTH = 6;
export const REQUEST_CODE_LABEL = "요청번호";

const CODE = `[${ALPHABET}]{${REQUEST_CODE_LENGTH}}`;
/** 문구를 그대로 보낸 경우. 라벨이 붙어 있으면 오인 여지가 없다. */
const LABELED = new RegExp(`${REQUEST_CODE_LABEL}\\s*[:：]?\\s*(${CODE})`);
/** 번호만 따로 적어 보낸 경우. 더 긴 영숫자 덩어리의 일부는 제외한다. */
const STANDALONE = new RegExp(`(?<![0-9A-Za-z])(${CODE})(?![0-9A-Za-z])`, "g");

export function generateQuoteRequestCode(
  randomInt: (max: number) => number = (max) => Math.floor(Math.random() * max)
): string {
  let code = "";
  for (let i = 0; i < REQUEST_CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * 고객이 보낸 메시지에서 요청번호를 찾는다. 문구를 그대로 붙여넣지 않고 앞뒤로
 * 말을 덧붙이는 경우가 흔해 전체 일치를 요구하지 않는다. 소문자로 입력해도 받는다.
 *
 * 라벨 없이 후보가 둘 이상이면 어느 견적서를 보낼지 단정할 수 없으므로 null 을
 * 돌려주고, 상담사가 어드민에서 직접 처리하도록 남긴다.
 */
export function extractQuoteRequestCode(message: string): string | null {
  const upper = message.toUpperCase();

  const labeled = upper.match(LABELED);
  if (labeled) return labeled[1];

  const found = [...upper.matchAll(STANDALONE)].map((match) => match[1]);
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : null;
}
