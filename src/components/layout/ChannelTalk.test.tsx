import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

const auth = vi.hoisted(() => {
  let listener: ((event: string) => void) | null = null;
  return {
    unsubscribe: vi.fn(),
    reset() {
      listener = null;
    },
    emit(event: string) {
      listener?.(event);
    },
    onAuthStateChange(cb: (event: string) => void) {
      listener = cb;
      return {
        data: { subscription: { unsubscribe: auth.unsubscribe } },
      };
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      // ChannelTalkButton 이 useAuthUser 를 통해 getUser 를 호출한다(비회원으로 응답).
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: auth.onAuthStateChange,
    },
  }),
}));

import { ChannelTalkButton } from "@/components/quote/ChannelTalkButton";
import { CHANNEL_TALK_STATUS_ATTR } from "@/lib/channel-talk-status";
import { CHANNEL_TALK_IDENTITY_RETRY_MS, ChannelTalk } from "./ChannelTalk";
const MEMBER_IDENTITY = {
  anonymous: false as const,
  memberId: "user-member-1",
  profile: { name: "김재현" },
};

function loadedPluginScripts(): Element[] {
  return Array.from(document.querySelectorAll('script[src*="cdn.channel.io"]'));
}

function channelQueue(): unknown[][] {
  const queued = (window.ChannelIO as { q?: unknown[][] } | undefined)?.q;
  return queued ?? [];
}

function bootPayloads(): Record<string, unknown>[] {
  return channelQueue()
    .filter((args) => args[0] === "boot")
    .map((args) => (args[1] ?? {}) as Record<string, unknown>);
}

function jsonResponse(ok: boolean, body: unknown) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(body),
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY", "test-plugin-key");
  navigation.pathname = "/";
  auth.reset();
  auth.unsubscribe.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  loadedPluginScripts().forEach((script) => script.remove());
  delete window.ChannelIO;
  delete window.ChannelIOInitialized;
  document.documentElement.removeAttribute(CHANNEL_TALK_STATUS_ATTR);
});

describe("ChannelTalk third-party script boundary", () => {
  it("loads the plugin on ordinary public pages", async () => {
    navigation.pathname = "/cars";

    render(<ChannelTalk />);

    await waitFor(() => expect(loadedPluginScripts()).toHaveLength(1));
    expect(window.ChannelIO).toBeTypeOf("function");
  });

  it("never loads the plugin on the resident registration input page", async () => {
    navigation.pathname = "/verify";

    render(<ChannelTalk />);

    await waitFor(() => expect(loadedPluginScripts()).toHaveLength(0));
    expect(window.ChannelIO).toBeUndefined();
  });

  it("shuts down an already-booted widget when entering the verification page", async () => {
    navigation.pathname = "/quote";
    const { unmount } = render(<ChannelTalk />);
    await waitFor(() => expect(window.ChannelIO).toBeTypeOf("function"));
    unmount();

    const calls: unknown[][] = [];
    window.ChannelIO = ((...args: unknown[]) => {
      calls.push(args);
    }) as NonNullable<Window["ChannelIO"]>;
    window.ChannelIOInitialized = true;
    navigation.pathname = "/verify";

    render(<ChannelTalk />);

    await waitFor(() => expect(window.ChannelIO).toBeUndefined());
    expect(calls).toEqual([["shutdown"]]);
    expect(window.ChannelIOInitialized).toBeUndefined();
  });
});

describe("ChannelTalk identity boot recovery", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  it("identity 가 두 번 실패한 뒤에만 anonymous 로 확정하고 재시도는 1회로 끝난다", async () => {
    fetchMock.mockRejectedValue(new Error("identity down"));

    render(<ChannelTalk />);
    await act(async () => {
      auth.emit("INITIAL_SESSION");
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bootPayloads()).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_TALK_IDENTITY_RETRY_MS);
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bootPayloads()).toHaveLength(1);
    expect(bootPayloads()[0]).toMatchObject({
      pluginKey: "test-plugin-key",
      hideChannelButtonOnBoot: true,
    });
    expect(bootPayloads()[0].memberId).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_TALK_IDENTITY_RETRY_MS * 4);
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("anonymous 확정 이후 SIGNED_IN 이면 member 로 재부팅한다", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("identity down"))
      .mockRejectedValueOnce(new Error("identity down"))
      .mockResolvedValueOnce(jsonResponse(true, MEMBER_IDENTITY));

    render(<ChannelTalk />);
    await act(async () => {
      auth.emit("INITIAL_SESSION");
    });
    await flushPromises();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_TALK_IDENTITY_RETRY_MS);
    });
    await flushPromises();

    expect(bootPayloads()).toHaveLength(1);
    expect(bootPayloads()[0].memberId).toBeUndefined();

    await act(async () => {
      auth.emit("SIGNED_IN");
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const boots = bootPayloads();
    expect(boots).toHaveLength(2);
    expect(boots[1]).toMatchObject({
      memberId: "user-member-1",
      profile: { name: "김재현" },
    });
  });

  it("최초 identity 성공이면 anonymous 로 부팅하지 않는다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true, MEMBER_IDENTITY));

    render(<ChannelTalk />);
    await act(async () => {
      auth.emit("INITIAL_SESSION");
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bootPayloads()).toEqual([
      expect.objectContaining({
        memberId: "user-member-1",
        profile: { name: "김재현" },
      }),
    ]);
  });
});

describe("ChannelTalk SDK load failure surface", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse(true, MEMBER_IDENTITY));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("keeps a host-provided ChannelIO ready when the plugin key is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY", "");
    window.ChannelIO = () => undefined;

    render(<ChannelTalk />);

    await waitFor(() => {
      expect(document.documentElement.getAttribute(CHANNEL_TALK_STATUS_ATTR)).toBe("ready");
    });
    expect(loadedPluginScripts()).toHaveLength(0);
  });

  it("marks failed when the plugin key is unset and ChannelIO is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY", "");

    render(<ChannelTalk />);

    await waitFor(() => {
      expect(document.documentElement.getAttribute(CHANNEL_TALK_STATUS_ATTR)).toBe("failed");
    });
    expect(loadedPluginScripts()).toHaveLength(0);
  });

  it("marks the document failed and disables consult buttons when the plugin script errors", async () => {
    render(
      <>
        <ChannelTalk />
        <ChannelTalkButton label="상담하기" />
      </>
    );

    await waitFor(() => expect(loadedPluginScripts()).toHaveLength(1));
    const script = loadedPluginScripts()[0];
    expect(script).toBeDefined();
    fireEvent.error(script as HTMLScriptElement);

    await waitFor(() => {
      expect(document.documentElement.getAttribute(CHANNEL_TALK_STATUS_ATTR)).toBe("failed");
    });
    const consult = screen.getByRole("button", { name: "채팅 준비 중" });
    expect(consult).toBeDisabled();
    expect(consult).toHaveAttribute("title", "잠시 후 다시");
  });
});
