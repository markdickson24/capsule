import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';

const DEFAULT_ACCENT = '#FF6B35';
const DEFAULT_HOME_LAYOUT: HomeLayout = 'list';

export type HomeLayout = 'list' | 'grid';

type ThemeContextType = {
  accentColor: string;
  setAccentColor: (color: string) => Promise<void>;
  homeLayout: HomeLayout;
  setHomeLayout: (layout: HomeLayout) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextType>({
  accentColor: DEFAULT_ACCENT,
  setAccentColor: async () => {},
  homeLayout: DEFAULT_HOME_LAYOUT,
  setHomeLayout: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT);
  const [homeLayout, setHomeLayoutState] = useState<HomeLayout>(DEFAULT_HOME_LAYOUT);

  useEffect(() => {
    let loaded = false;

    async function loadPrefs(userId: string) {
      try {
        const { data } = await supabase
          .from('users')
          .select('accent_color, home_layout')
          .eq('id', userId)
          .single();
        if ((data as any)?.accent_color) setAccentColorState((data as any).accent_color);
        if ((data as any)?.home_layout === 'grid' || (data as any)?.home_layout === 'list') {
          setHomeLayoutState((data as any).home_layout);
        }
        loaded = true;
      } catch {}
    }

    const initial = sessionStore.get();
    if (initial?.user) loadPrefs(initial.user.id);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAccentColorState(DEFAULT_ACCENT);
        setHomeLayoutState(DEFAULT_HOME_LAYOUT);
        loaded = false;
      } else if (event === 'SIGNED_IN' && session?.user) {
        loadPrefs(session.user.id);
      } else if (event === 'INITIAL_SESSION' && !loaded && session?.user) {
        loadPrefs(session.user.id);
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

  async function setHomeLayout(layout: HomeLayout) {
    setHomeLayoutState(layout);
    const session = sessionStore.get();
    if (session) {
      await supabase.from('users').update({ home_layout: layout }).eq('id', session.user.id);
    }
  }

  return (
    <ThemeContext.Provider value={{ accentColor, setAccentColor, homeLayout, setHomeLayout }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
