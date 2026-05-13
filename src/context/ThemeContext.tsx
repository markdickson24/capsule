import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data } = await supabase
          .from('users')
          .select('accent_color')
          .eq('id', session.user.id)
          .single();
        if ((data as any)?.accent_color) setAccentColorState((data as any).accent_color);
      } else {
        setAccentColorState(DEFAULT_ACCENT);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function setAccentColor(color: string) {
    setAccentColorState(color);
    const { data: { session } } = await supabase.auth.getSession();
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
