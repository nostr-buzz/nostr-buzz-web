import { useContext } from 'react';

import { CallContext, type CallContextValue } from '@/contexts/CallContext';

export function useCalls(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCalls must be used inside <CallProvider>');
  return context;
}
