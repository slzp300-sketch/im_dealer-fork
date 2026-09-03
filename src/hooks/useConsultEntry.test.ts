import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  useAuthUser: vi.fn(),
  isMobileDevice: vi.fn(),
  openChannelTalk: vi.fn(),
  isMemberMobileConsultEnabled: vi.fn(),
}));

vi.mock("@/hooks/useAuthUser", () => ({ useAuthUser: mocks.useAuthUser }));
vi.mock("@/lib/browser/device", () => ({ isMobileDevice: mocks.isMobileDevice }));
vi.mock("@/lib/channel-talk", () => ({ openChannelTalk: mocks.openChannelTalk }));
vi.mock("@/lib/consult-entry", () => ({
  isMemberMobileConsultEnabled: mocks.isMemberMobileConsultEnabled,
}));

import { useConsultEntry } from "./useConsultEntry";

const MEMBER = { id: "u-1", phone: "010-1234-5678" } as unknown as User;

describe("useConsultEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuthUser.mockReturnValue({ user: MEMBER, isLoading: false });
    mocks.isMobileDevice.mockReturnValue(true);
    mocks.isMemberMobileConsultEnabled.mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true } as Response)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("플래그 ON + 모바일 + 회원 → /api/public/consult 로 POST 하고 카카오는 열지 않는다", async () => {
    const { result } = renderHook(() => useConsultEntry());

    act(() => result.current.start("header"));

    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/public/consult",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ source: "header" }),
      }),
    );
    expect(mocks.openChannelTalk).not.toHaveBeenCalled();
  });

  it("플래그 OFF → openChannelTalk 을 호출하고 POST 하지 않는다", () => {
    mocks.isMemberMobileConsultEnabled.mockReturnValue(false);
    const { result } = renderHook(() => useConsultEntry());

    act(() => result.current.start());

    expect(mocks.openChannelTalk).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("회원이지만 PC → openChannelTalk 을 호출하고 POST 하지 않는다", () => {
    mocks.isMobileDevice.mockReturnValue(false);
    const { result } = renderHook(() => useConsultEntry());

    act(() => result.current.start());

    expect(mocks.openChannelTalk).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("비회원(모바일·플래그 ON) → openChannelTalk 을 호출하고 POST 하지 않는다", () => {
    mocks.useAuthUser.mockReturnValue({ user: null, isLoading: false });
    const { result } = renderHook(() => useConsultEntry());

    act(() => result.current.start());

    expect(mocks.openChannelTalk).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("발송 실패 → status 는 error 이고 openChannelTalk 으로 폴백한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false } as Response)),
    );
    const { result } = renderHook(() => useConsultEntry());

    act(() => result.current.start());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(mocks.openChannelTalk).toHaveBeenCalledTimes(1);
  });
});
