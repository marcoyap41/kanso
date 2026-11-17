'use client';

import React, { useEffect, useState } from 'react';
import { api, getStoredToken, setStoredToken } from '@/lib/api';
import { AuthScreen } from '@/components/AuthScreen';
import { KansoApp } from '@/components/KansoApp';
import type { User } from '@/types/kanso';

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setCheckingSession(false);
      return;
    }

    api
      .me()
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => {
        setCheckingSession(false);
      });
  }, []);

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          <span>kanso</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={(u) => setUser(u)} />;
  }

  return (
    <KansoApp
      user={user}
      onLogout={() => {
        setStoredToken(null);
        setUser(null);
      }}
    />
  );
}
