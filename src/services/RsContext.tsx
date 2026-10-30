import React, { createContext, useContext } from 'react';
import { Rs485Service } from './rs485Service';

const Ctx = createContext<Rs485Service | null>(null);
export const RsProvider = ({ manager, children }: { manager: Rs485Service; children: React.ReactNode }) => (
  <Ctx.Provider value={manager}>{children}</Ctx.Provider>
);
export const useRs485 = () => {
  const m = useContext(Ctx);
  if (!m) throw new Error('useRs485 must be used inside <RsProvider>');
  return m;
};
