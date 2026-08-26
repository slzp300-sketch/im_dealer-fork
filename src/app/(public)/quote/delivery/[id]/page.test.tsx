import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuoteDeliveryPage, {
  generateMetadata,
  isQuoteDeliveryLinkExpired,
} from "./page";

const mocks = vi.hoisted(() => ({
  findDelivery: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quoteDelivery: {
      findUnique: mocks.findDelivery,
    },
  },
}));

vi.mock("next/image", async () => {
  const { createElement } = await import("react");
  return {
    default: ({
      src,
      alt,
    }: {
      readonly src: string;
      readonly alt: string;
    }) => createElement("img", { src, alt }),
  };
});

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const NOW = new Date("2026-08-19T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function sentDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    vehicleName: "쏘렌토",
    imagePath: "deliveries/quote.png",
    status: "SENT",
    imageDeletedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.findDelivery.mockReset();
  mocks.findDelivery.mockResolvedValue(sentDelivery());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("QuoteDeliveryPage", () => {
  it("shows the exact PNG that was sent to Kakao", async () => {
    const page = await QuoteDeliveryPage({
      params: Promise.resolve({ id: "delivery-1" }),
    });

    render(page);

    expect(screen.getByRole("heading", { name: "쏘렌토 견적서" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "쏘렌토 견적서" })).toHaveAttribute(
      "src",
      "https://storage.example/storage/v1/object/public/quotes/deliveries/quote.png"
    );
    expect(screen.getByRole("link", { name: "새 견적 확인하기" })).toHaveAttribute(
      "href",
      "/cars"
    );
  });

  it("원본 이미지를 새 탭으로 열 수 있게 하고 저장 링크를 함께 제공한다", async () => {
    const page = await QuoteDeliveryPage({
      params: Promise.resolve({ id: "delivery-1" }),
    });

    render(page);

    const imageUrl =
      "https://storage.example/storage/v1/object/public/quotes/deliveries/quote.png";

    // 이미지 자체를 눌러도, 아래 버튼을 눌러도 원본이 새 탭에서 열려야 한다.
    for (const name of ["쏘렌토 견적서 원본 크게 보기", "크게 보기"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", imageUrl);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }

    // 스토리지가 다른 오리진이라 download 속성 대신 ?download= 로 받아야 저장된다.
    expect(screen.getByRole("link", { name: "이미지 저장" })).toHaveAttribute(
      "href",
      `${imageUrl}?download=imdealer-quote.png`
    );
  });

  it("exposes the exact quote image as Open Graph metadata for Kakao scraping", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: "delivery-1" }),
    });

    expect(metadata.openGraph).toMatchObject({
      title: "쏘렌토 견적서",
      images: [
        {
          url: "https://storage.example/storage/v1/object/public/quotes/deliveries/quote.png",
          width: 1240,
          height: 1754,
        },
      ],
    });
  });

  it("does not render an image after lifecycle cleanup marks it deleted", async () => {
    mocks.findDelivery.mockResolvedValue(
      sentDelivery({
        imageDeletedAt: new Date("2026-07-28T00:00:00.000Z"),
      })
    );

    await expect(
      QuoteDeliveryPage({ params: Promise.resolve({ id: "delivery-1" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      generateMetadata({ params: Promise.resolve({ id: "delivery-1" }) })
    ).resolves.toMatchObject({ robots: { index: false, follow: false } });
  });

  it("PENDING 상태면 견적 이미지를 숨기고 준비 중 안내를 보여준다", async () => {
    mocks.findDelivery.mockResolvedValue(sentDelivery({ status: "PENDING" }));

    const page = await QuoteDeliveryPage({
      params: Promise.resolve({ id: "delivery-1" }),
    });
    render(page);

    expect(screen.getByText(/준비 중/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "쏘렌토 견적서" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "이미지 저장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "쏘렌토 견적서" })).not.toBeInTheDocument();

    await expect(
      generateMetadata({ params: Promise.resolve({ id: "delivery-1" }) })
    ).resolves.toMatchObject({
      title: "견적서",
      robots: { index: false, follow: false },
    });
  });

  it("createdAt 기준 31일이 지나면 만료 안내를 보여주고 이미지를 숨긴다", async () => {
    mocks.findDelivery.mockResolvedValue(
      sentDelivery({
        createdAt: new Date(NOW.getTime() - 31 * DAY_MS),
      })
    );

    const page = await QuoteDeliveryPage({
      params: Promise.resolve({ id: "delivery-1" }),
    });
    render(page);

    expect(screen.getByText(/만료/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "쏘렌토 견적서" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "로그인" })).not.toBeInTheDocument();

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: "delivery-1" }),
    });
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata).toMatchObject({
      title: "견적서",
      robots: { index: false, follow: false },
    });
  });

  it("SENT 이고 29일이면 견적 이미지를 그대로 렌더한다", async () => {
    mocks.findDelivery.mockResolvedValue(
      sentDelivery({
        createdAt: new Date(NOW.getTime() - 29 * DAY_MS),
      })
    );

    const page = await QuoteDeliveryPage({
      params: Promise.resolve({ id: "delivery-1" }),
    });
    render(page);

    expect(screen.getByRole("heading", { name: "쏘렌토 견적서" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "쏘렌토 견적서" })).toHaveAttribute(
      "src",
      "https://storage.example/storage/v1/object/public/quotes/deliveries/quote.png"
    );
    expect(screen.queryByText(/만료/)).not.toBeInTheDocument();
    expect(screen.queryByText(/준비 중/)).not.toBeInTheDocument();
  });

  it("createdAt 기준 30일 정각은 만료로 본다", () => {
    const createdAt = new Date(NOW.getTime() - 30 * DAY_MS);
    expect(isQuoteDeliveryLinkExpired(createdAt, NOW)).toBe(true);
    expect(
      isQuoteDeliveryLinkExpired(new Date(NOW.getTime() - 30 * DAY_MS + 1), NOW)
    ).toBe(false);
  });
});
