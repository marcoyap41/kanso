'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  api,
  hasSessionHint,
  setOnSessionLost,
  setSessionHint,
} from '@/lib/api';
import { AuthScreen } from '@/components/AuthScreen';
import { KansoApp } from '@/components/KansoApp';
import { NameOnboardingScreen } from '@/components/NameOnboardingScreen';
import type { User } from '@/types/kanso';

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const processAuthHash = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    const hash = window.location.hash || '';

    const authErrMatch = hash.match(/(?:^|[#&])auth_error=([^&]+)/);
    if (authErrMatch) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
      setAuthError(decodeURIComponent(authErrMatch[1]));
      return true;
    }

    const verifyMatch = hash.match(/(?:^|[#&])verify=([^&]+)/);
    if (verifyMatch) {
      const token = decodeURIComponent(verifyMatch[1]);
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
      try {
        const res = await api.verifyEmail(token);
        setAuthError(null);
        setUser(res.user);
      } catch (err) {
        setSessionHint(false);
        setUser(null);
        setAuthError(
          err instanceof Error
            ? err.message
            : 'This verification link is invalid or has expired.'
        );
      }
      return true;
    }

    if (hash.includes('auth=success')) {
      const ticketMatch = hash.match(/(?:^|[#&])ticket=([^&]+)/);
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
      if (ticketMatch) {
        try {
          const res = await api.exchangeOAuthTicket(
            decodeURIComponent(ticketMatch[1])
          );
          setAuthError(null);
          setUser(res.user);
          return true;
        } catch (err) {
          const restored = await api.refresh();
          if (restored) {
            setAuthError(null);
            setUser(restored);
            return true;
          }
          setSessionHint(false);
          setUser(null);
          setAuthError(
            err instanceof Error
              ? err.message
              : 'OAuth sign-in expired or failed. Please try again.'
          );
          return true;
        }
      }

      const restored = await api.refresh();
      if (restored) {
        setAuthError(null);
        setUser(restored);
      }
      return true;
    }

    return false;
  }, []);

  useEffect(() => {
    let active = true;

    setOnSessionLost(() => {
      if (active) setUser(null);
    });

    async function init() {
      const handledHash = await processAuthHash();
      if (!active) return;
      if (handledHash) {
        setCheckingSession(false);
        return;
      }

      if (!hasSessionHint()) {
        setCheckingSession(false);
        return;
      }

      try {
        const restored = await api.refresh();
        if (active && restored) {
          setUser(restored);
        }
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    void init();

    function handleHashChange() {
      void processAuthHash();
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      active = false;
      setOnSessionLost(null);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [processAuthHash]);

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#070709] text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-[0.24em] text-zinc-500">
          <span className="h-2 w-2 rounded-[1px] bg-white animate-pulse" />
          <span>kanso // initializing</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        initialError={authError}
        onClearInitialError={() => setAuthError(null)}
        onAuthenticated={(u) => {
          setAuthError(null);
          setUser(u);
        }}
      />
    );
  }

  if (!user.name) {
    return (
      <NameOnboardingScreen
        initialName=""
        onCompleted={(updated) => setUser(updated)}
      />
    );
  }

  return (
    <KansoApp
      user={user}
      onUserUpdated={(updated) => setUser(updated)}
      onLogout={() => {
        void api.logout();
        setUser(null);
      }}
    />
  );
}
