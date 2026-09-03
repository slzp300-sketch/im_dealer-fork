"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * 현재 Supabase 세션의 로그인 사용자를 구독한다.
 * 회원/비회원 분기에 사용 (user === null 이면 비회원).
 *
 * Header.tsx 의 getUser + onAuthStateChange 패턴을 재사용 가능하도록 추출한 훅.
 */
export function useAuthUser(): { user: User | null; isLoading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Supabase 클라이언트 생성이 실패해도(예: 환경변수 미설정) 훅이 크래시하지 않도록
    // 방어한다 — 이 경우 비회원(user=null)으로 둔다. setState 는 프라미스로 미뤄
    // 이펙트 본문 동기 setState 경고를 피한다(아래 정상 경로와 동일한 방식).
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      void Promise.resolve().then(() => {
        setUser(null);
        setIsLoading(false);
      });
      return;
    }

    supabase.auth
      .getUser()
      .then(({ data }) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { user, isLoading };
}
