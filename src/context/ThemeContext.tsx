import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';

const DEFAULT_ACCENT = '#FF6B35';

type ThemeContextType = {
  accentColor: string;
  setAccentColor: (color: string) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextType>({
  accentColor: DEFAULT_ACCENT,
  setAccentColor: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT);

  useEffect(() => {
    let loaded = false;

    async function loadColor(userId: string) {
      try {
        const { data } = await supabase
          .from('users')
          .select('accent_color')
          .eq('id', userId)
          .single();
        if ((data as any)?.accent_color) setAccentColorState((data as any).accent_color);
        loaded = true;
      } catch {}
    }

    const initial = sessionStore.get();
    if (initial?.user) loadColor(initial.user.id);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAccentColorState(DEFAULT_ACCENT);
        loaded = false;
      } else if (event === 'SIGNED_IN' && session?.user) {
        loadColor(session.user.id);
      } else if (event === 'INITIAL_SESSION' && !loaded && session?.user) {
        loadColor(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function setAccentColor(color: string) {
    setAccentColorState(color);
    const session = sessionStore.get();
    if (session) {
      await supabase.from('users').update({ accent_color: color }).eq('id', session.user.id);
    }
  }

  return (
    <ThemeContext.Provider value={{ accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
