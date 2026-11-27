import { ReactNode, useEffect } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme, type RelayMetadata, type BlossomServerMetadata, type ChatSettings } from '@/contexts/AppContext';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

// Zod schema for RelayMetadata validation
const RelayMetadataSchema = z.object({
  relays: z.array(z.object({
    url: z.url(),
    read: z.boolean(),
    write: z.boolean(),
  })),
  updatedAt: z.number(),
}) satisfies z.ZodType<RelayMetadata>;

// Zod schema for BlossomServerMetadata validation
const BlossomServerMetadataSchema = z.object({
  servers: z.array(z.url()),
  updatedAt: z.number(),
}) satisfies z.ZodType<BlossomServerMetadata>;

// Zod schema for nostr.buzz chat settings (every key optional; defaults fill gaps)
const ChatSettingsSchema = z.object({
  messageSound: z.boolean(),
  buzzSound: z.boolean(),
  buzzShake: z.boolean(),
  vibrate: z.boolean(),
  notifications: z.boolean(),
  notificationPreviews: z.boolean(),
  legacyDMs: z.boolean(),
  buzzFromStrangers: z.boolean(),
  enterToSend: z.boolean(),
}).partial() satisfies z.ZodType<Partial<ChatSettings>>;

// Zod schema for AppConfig validation
const AppConfigSchema = z.object({
  chat: ChatSettingsSchema.optional(),
  theme: z.enum(['dark', 'light', 'system']),
  relayMetadata: RelayMetadataSchema,
  blossomServerMetadata: BlossomServerMetadataSchema,
  useAppBlossomServers: z.boolean(),
}) satisfies z.ZodType<AppConfig>;

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;

  // App configuration state with localStorage persistence
  const [rawConfig, setConfig] = useLocalStorage<Partial<AppConfig>>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        return AppConfigSchema.partial().parse(parsed);
      }
    }
  );

  // Generic config updater with callback pattern
  const updateConfig = (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
    setConfig(updater);
  };

  const config = { ...defaultConfig, ...rawConfig };

  const appContextValue: AppContextType = {
    config,
    updateConfig,
  };

  // Apply theme effects to document
  useApplyTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Paint the browser / system bars (status bar, Android task switcher) in the app's
 * background color, so the app runs edge to edge like a native one.
 */
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = getComputedStyle(document.body).backgroundColor;
  if (meta && color) meta.setAttribute('content', color);
}

/**
 * Hook to apply theme changes to the document root
 */
function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      syncThemeColor();
      return;
    }

    root.classList.add(theme);
    syncThemeColor();
  }, [theme]);

  // Handle system theme changes when theme is set to "system"
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');

      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      syncThemeColor();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
}