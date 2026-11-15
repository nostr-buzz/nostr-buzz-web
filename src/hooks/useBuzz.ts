import { useContext } from 'react';

import { BuzzContext, type BuzzContextValue } from '@/contexts/BuzzContext';

export function useBuzz(): BuzzContextValue {
  const context = useContext(BuzzContext);
  if (!context) throw new Error('useBuzz must be used inside <BuzzProvider>');
  return context;
}
