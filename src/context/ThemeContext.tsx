import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { toast } from '../lib/toast';
import { parseGradient, serializeGradient } from '../lib/accentPresets';

// Brand reddish-coral, matching the website (--accent: #FC6A5B). New accounts
// default to this (DB column default on users.accent_color is set to match);
// existing users keep whatever they had — nothing migrates their color.
const DEFAULT_ACCENT = '#FC6A5B';
const DEFAULT_HOME_LAYOUT: HomeLayout = 'list';
const THEME_CACHE_PREFIX = 'cap_theme_v1:';

export type HomeLayout = 'list' | 'grid';

type CachedTheme = { accentColor?: string; homeLayout?: HomeLayout; accentGradient?: string | null };

// Mirrors sessionStore's readWebSessionSync — reads directly from
// localStorage (synchronous, unlike AsyncStorage) so it can seed the
// accentColor/homeLayout useState's initial value on the very first render,
// before paint. This is what makes web genuinely flash-free: without it,
// accentColor starts at DEFAULT_ACCENT and only updates once the Supabase
// fetch below resolves, so the app visibly renders the wrong (default
// orange) color for however long that network round-trip takes.
function readCachedThemeSync(userId: string): CachedTheme | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(`${THEME_CACHE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Native session restore is async, so userId isn't known synchronously at
// mount the way it is on web — this is the native fallback, used inside
// loadPrefs as a cache-then-network read. AsyncStorage is local (no network),
// so this still resolves in single-digit milliseconds, shrinking the flash
// from "however long the network takes" to imperceptible.
async function readCachedTheme(userId: string): Promise<CachedTheme | null> {
  try {
    const raw = await AsyncStorage.getItem(`${THEME_CACHE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedTheme(userId: string, prefs: { accentColor: string; homeLayout: HomeLayout; accentGradient: string | null }) {
  const value = JSON.stringify(prefs);
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(`${THEME_CACHE_PREFIX}${userId}`, value); } catch {}
  } else {
    AsyncStorage.setItem(`${THEME_CACHE_PREFIX}${userId}`, value).catch(() => {});
  }
}

type ThemeContextType = {
  accentColor: string;
  setAccentColor: (color: string) => Promise<void>;
  homeLayout: HomeLayout;
  setHomeLayout: (layout: HomeLayout) => Promise<void>;
  accentGradient: [string, string] | null;
  setAccentGradient: (g: [string, string] | null) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextType>({
  accentColor: DEFAULT_ACCENT,
  setAccentColor: async () => {},
  homeLayout: DEFAULT_HOME_LAYOUT,
  setHomeLayout: async () => {},
  accentGradient: null,
  setAccentGradient: async () => {},
});

// Lazy useState initializers run synchronously during the first render — this
// is what a useEffect can't do (it only runs after paint). On web,
// sessionStore.get() is already synchronously populated at module load (see
// sessionStore.ts), so this can seed the real cached color before the app
// ever paints the default. On native, session restore is async, so
// sessionStore.get() is typically still null this early — native's fix is the
// cache-then-network read inside loadPrefs below instead.
function initialAccentColor(): string {
  const session = sessionStore.get();
  if (session?.user) {
    const cached = readCachedThemeSync(session.user.id);
    if (cached?.accentColor) return cached.accentColor;
  }
  return DEFAULT_ACCENT;
}

function initialHomeLayout(): HomeLayout {
  const session = sessionStore.get();
  if (session?.user) {
    const cached = readCachedThemeSync(session.user.id);
    if (cached?.homeLayout) return cached.homeLayout;
  }
  return DEFAULT_HOME_LAYOUT;
}

function initialAccentGradient(): [string, string] | null {
  const session = sessionStore.get();
  if (session?.user) {
    const cached = readCachedThemeSync(session.user.id);
    if (cached?.accentGradient) return parseGradient(cached.accentGradient);
  }
  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColorState] = useState(initialAccentColor);
  const [homeLayout, setHomeLayoutState] = useState<HomeLayout>(initialHomeLayout);
  const [accentGradient, setAccentGradientState] = useState<[string, string] | null>(initialAccentGradient);

  useEffect(() => {
    let loaded = false;

    async function loadPrefs(userId: string) {
      // Cache-then-network: apply a fast local cache hit immediately. This is
      // the native fix (AsyncStorage, no network, single-digit ms) — on web
      // it's usually redundant with the lazy useState seed above, but harmless.
      const cached = await readCachedTheme(userId);
      if (cached?.accentColor) setAccentColorState(cached.accentColor);
      if (cached?.homeLayout === 'grid' || cached?.homeLayout === 'list') {
        setHomeLayoutState(cached.homeLayout);
      }
      if (cached?.accentGradient !== undefined) setAccentGradientState(parseGradient(cached.accentGradient));

      try {
        const { data } = await supabase
          .from('users')
          .select('accent_color, home_layout, accent_gradient')
          .eq('id', userId)
          .single();
        const accent = (data as any)?.accent_color;
        const layout = (data as any)?.home_layout;
        if (accent) setAccentColorState(accent);
        if (layout === 'grid' || layout === 'list') setHomeLayoutState(layout);
        const grad = parseGradient((data as any)?.accent_gradient);
        setAccentGradientState(grad);
        if (accent || layout === 'grid' || layout === 'list') {
          writeCachedTheme(userId, {
            accentColor: accent ?? cached?.accentColor ?? DEFAULT_ACCENT,
            homeLayout: (layout === 'grid' || layout === 'list') ? layout : (cached?.homeLayout ?? DEFAULT_HOME_LAYOUT),
            accentGradient: (data as any)?.accent_gradient ?? null,
          });
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
        setAccentGradientState(null);
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
    setAccentGradientState(null);
    const session = sessionStore.get();
    if (session) {
      writeCachedTheme(session.user.id, { accentColor: color, homeLayout, accentGradient: null });
      const { error } = await supabase.from('users').update({ accent_color: color, accent_gradient: null }).eq('id', session.user.id);
      // State/local cache already updated, so the color still looks saved on
      // this device — but it won't survive a fresh sign-in elsewhere or a
      // cache-miss without this toast telling the user the write didn't land.
      if (error) toast.show("Couldn't save your color — try again.");
    }
  }

  async function setHomeLayout(layout: HomeLayout) {
    setHomeLayoutState(layout);
    const session = sessionStore.get();
    if (session) {
      writeCachedTheme(session.user.id, { accentColor, homeLayout: layout, accentGradient: accentGradient ? serializeGradient(accentGradient) : null });
      const { error } = await supabase.from('users').update({ home_layout: layout }).eq('id', session.user.id);
      if (error) toast.show("Couldn't save your layout preference — try again.");
    }
  }

  // Pro-only (gate is in the UI). Persists the gradient AND sets accent_color to
  // its first color, so every non-gradient surface keeps a coherent solid.
  async function setAccentGradient(g: [string, string] | null) {
    setAccentGradientState(g);
    const solid = g ? g[0] : accentColor;
    if (g) setAccentColorState(solid);
    const session = sessionStore.get();
    if (session) {
      const serialized = g ? serializeGradient(g) : null;
      writeCachedTheme(session.user.id, { accentColor: solid, homeLayout, accentGradient: serialized });
      const { error } = await supabase.from('users').update({ accent_gradient: serialized, accent_color: solid }).eq('id', session.user.id);
      if (error) toast.show("Couldn't save your theme — try again.");
    }
  }

  return (
    <ThemeContext.Provider value={{ accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
