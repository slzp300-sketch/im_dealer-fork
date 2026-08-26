export const QUOTE_IMAGE_BUCKET = "quotes";

// 카카오가 전달 직후 이미지를 스크랩할 시간을 확보하되, 공개 객체와
// CDN 캐시가 장기간 남지 않도록 수명을 명시적으로 제한한다.
export const QUOTE_IMAGE_RETENTION_DAYS = 7;
export const QUOTE_IMAGE_CACHE_CONTROL_SECONDS = 24 * 60 * 60;

export function quoteImagePublicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${QUOTE_IMAGE_BUCKET}/${path}`;
}

// 스토리지는 앱과 다른 오리진이라 <a download> 속성이 무시된다. 저장으로 받게 하려면
// ?download= 로 Content-Disposition 을 받아야 한다. 값이 응답 헤더에 그대로 실리므로
// 파일명은 ASCII 로 유지한다(한글을 넣으면 브라우저에서 깨진 이름으로 저장된다).
export const QUOTE_IMAGE_DOWNLOAD_FILENAME = "imdealer-quote.png";

export function quoteImageDownloadUrl(path: string): string {
  return `${quoteImagePublicUrl(path)}?download=${QUOTE_IMAGE_DOWNLOAD_FILENAME}`;
}
