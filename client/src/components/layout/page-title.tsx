import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const Ctx = createContext<{ title: string; setTitle: (t: string) => void }>({ title: '', setTitle: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('');
  return <Ctx.Provider value={{ title, setTitle }}>{children}</Ctx.Provider>;
}

export const usePageTitleValue = () => useContext(Ctx).title;

/** Sets the top-bar title and the browser tab title. */
export function usePageTitle(title: string) {
  const { setTitle } = useContext(Ctx);
  useEffect(() => {
    setTitle(title);
    document.title = title ? `${title} · Rivoora Textile` : 'Rivoora Textile';
  }, [title, setTitle]);
}
