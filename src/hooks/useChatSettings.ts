import { useCallback, useMemo } from 'react';

import type { ChatSettings } from '@/contexts/AppContext';
import { useAppContext } from '@/hooks/useAppContext';

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  messageSound: true,
  buzzSound: true,
  buzzShake: true,
  vibrate: true,
  notifications: false,
  notificationPreviews: true,
  legacyDMs: true,
  buzzFromStrangers: false,
  enterToSend: true,
};

/** Chat preferences merged with defaults, plus a partial updater. */
export function useChatSettings() {
  const { config, updateConfig } = useAppContext();

  const settings = useMemo<ChatSettings>(() => ({ ...DEFAULT_CHAT_SETTINGS, ...config.chat }), [config.chat]);

  const updateSettings = useCallback(
    (patch: Partial<ChatSettings>) => {
      updateConfig((current) => ({
        ...current,
        chat: { ...DEFAULT_CHAT_SETTINGS, ...current.chat, ...patch },
      }));
    },
    [updateConfig],
  );

  return { settings, updateSettings };
}
