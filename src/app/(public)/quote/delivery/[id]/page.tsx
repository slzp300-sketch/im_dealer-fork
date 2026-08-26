import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, Clock, Download, FileImage, ZoomIn } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  quoteImageDownloadUrl,
  quoteImagePublicUrl,
} from "@/lib/quote-delivery/public-url";

export const dynamic = "force-dynamic";

export const QUOTE_DELIVERY_LINK_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTE_DELIVERY_LINK_TTL_MS = QUOTE_DELIVERY_LINK_TTL_DAYS * DAY_MS;

type QuoteDeliveryPageProps = {
  readonly params: Promise<{
    readonly id: string;
  }>;
};

type QuoteDeliveryRecord = {
  readonly id: string;
  readonly vehicleName: string;
  readonly imagePath: string;
  readonly status: string;
  readonly imageDeletedAt: Date | null;
  readonly createdAt: Date;
};

type DeliveryView =
  | { kind: "missing" }
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "ready"; delivery: QuoteDeliveryRecord };

const noIndexRobots = {
  index: false,
  follow: false,
} as const;

const gatedMetadata: Metadata = {
  title: "견적서",
  robots: noIndexRobots,
};

export function isQuoteDeliveryLinkExpired(
  createdAt: Date,
  now: Date = new Date()
): boolean {
  return now.getTime() - createdAt.getTime() >= QUOTE_DELIVERY_LINK_TTL_MS;
}

function resolveDeliveryView(
  delivery: QuoteDeliveryRecord | null,
  now: Date = new Date()
): DeliveryView {
  if (!delivery || delivery.status === "FAILED" || delivery.imageDeletedAt) {
    return { kind: "missing" };
  }
  if (isQuoteDeliveryLinkExpired(delivery.createdAt, now)) {
    return { kind: "expired" };
  }
  if (delivery.status === "PENDING") {
    return { kind: "pending" };
  }
  if (delivery.status !== "SENT") {
    return { kind: "missing" };
  }
  return { kind: "ready", delivery };
}

export async function generateMetadata({
  params,
}: QuoteDeliveryPageProps): Promise<Metadata> {
  const { id } = await params;
  const view = resolveDeliveryView(await findQuoteDelivery(id));
  if (view.kind !== "ready") {
    return gatedMetadata;
  }

  const title = `${view.delivery.vehicleName} 견적서`;
  const description = "선택하신 조건으로 계산된 아임딜러 견적서입니다.";
  return {
    title,
    description,
    robots: noIndexRobots,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: quoteImagePublicUrl(view.delivery.imagePath),
          width: 1240,
          height: 1754,
          alt: title,
        },
      ],
    },
  };
}

export default async function QuoteDeliveryPage({ params }: QuoteDeliveryPageProps) {
  const { id } = await params;
  const view = resolveDeliveryView(await findQuoteDelivery(id));

  if (view.kind === "missing") {
    notFound();
  }

  if (view.kind === "pending") {
    return (
      <DeliveryGateNotice
        icon="pending"
        title="견적서를 준비 중이에요"
        body="전송이 끝나기 전입니다. 잠시 후 같은 링크로 다시 열어 주세요."
      />
    );
  }

  if (view.kind === "expired") {
    return (
      <DeliveryGateNotice
        icon="expired"
        title="견적서 링크가 만료되었어요"
        body="열람 기간(30일)이 지난 링크입니다. 새 견적이 필요하시면 아래에서 다시 확인해 주세요."
      />
    );
  }

  const imageUrl = quoteImagePublicUrl(view.delivery.imagePath);
  const downloadUrl = quoteImageDownloadUrl(view.delivery.imagePath);

  return (
    <main className="min-h-screen bg-app-bg px-4 py-8 md:py-14">
      <section className="mx-auto w-full max-w-3xl">
        <DeliveryPageHeader
          eyebrow="아임딜러 견적서"
          title={`${view.delivery.vehicleName} 견적서`}
        />

        {/* 견적서는 세로로 긴 PNG 라 페이지 안에서는 글씨가 작다.
            원본을 새 탭으로 열면 브라우저 기본 뷰어라 확대·축소가 그대로 된다. */}
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${view.delivery.vehicleName} 견적서 원본 크게 보기`}
          className="block overflow-hidden rounded-[20px] border border-border-subtle bg-surface shadow-card"
        >
          <Image
            src={imageUrl}
            alt={`${view.delivery.vehicleName} 견적서`}
            width={1240}
            height={1754}
            unoptimized
            className="block h-auto w-full"
          />
        </a>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryActionClass}
          >
            <ZoomIn size={17} />
            크게 보기
          </a>
          <a href={downloadUrl} className={secondaryActionClass}>
            <Download size={17} />
            이미지 저장
          </a>
        </div>

        <p className="mt-4 break-keep text-center text-[13px] leading-relaxed text-text-muted">
          실제 계약 조건과 프로모션에 따라 최종 금액이 달라질 수 있습니다.
        </p>

        <NewQuoteLink />
      </section>
    </main>
  );
}

const secondaryActionClass =
  "flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] border border-border-subtle bg-surface px-4 text-[14px] font-bold text-text-strong shadow-card transition-colors hover:bg-app-bg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/30";

function DeliveryGateNotice({
  icon,
  title,
  body,
}: {
  readonly icon: "pending" | "expired";
  readonly title: string;
  readonly body: string;
}) {
  return (
    <main className="min-h-screen bg-app-bg px-4 py-8 md:py-14">
      <section className="mx-auto w-full max-w-3xl">
        <DeliveryPageHeader eyebrow="아임딜러 견적서" title={title} />

        <div className="rounded-[20px] border border-border-subtle bg-surface px-6 py-10 text-center shadow-card">
          <span
            className={
              icon === "pending"
                ? "mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-soft text-brand"
                : "mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-status-warning-soft text-status-warning"
            }
          >
            {icon === "pending" ? <Clock size={22} /> : <AlertTriangle size={22} />}
          </span>
          <p className="mt-4 break-keep text-[13px] leading-relaxed text-text-muted">{body}</p>
        </div>

        <NewQuoteLink />
      </section>
    </main>
  );
}

function DeliveryPageHeader({
  eyebrow,
  title,
}: {
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-brand-soft text-brand">
        <FileImage size={21} />
      </span>
      <div>
        <p className="text-[12px] font-bold text-text-muted">{eyebrow}</p>
        <h1 className="break-keep text-[24px] font-extrabold tracking-[-0.03em] text-text-strong md:text-[30px]">
          {title}
        </h1>
      </div>
    </div>
  );
}

function NewQuoteLink() {
  return (
    <Link
      href="/cars"
      className="mx-auto mt-6 flex min-h-[52px] w-full max-w-sm items-center justify-center gap-2 rounded-[14px] bg-brand px-5 text-[15px] font-extrabold text-white shadow-card transition-colors hover:bg-brand-pressed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/30"
    >
      새 견적 확인하기
      <ArrowRight size={17} />
    </Link>
  );
}

function findQuoteDelivery(id: string) {
  return prisma.quoteDelivery.findUnique({
    where: { id },
    select: {
      id: true,
      vehicleName: true,
      imagePath: true,
      status: true,
      imageDeletedAt: true,
      createdAt: true,
    },
  });
}
