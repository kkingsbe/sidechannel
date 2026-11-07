import { createContext } from 'react';

// Page headings supply the same human-readable context to the app shell.
export const WorkspaceTitleContext = createContext<(title: string) => void>(() => {});
