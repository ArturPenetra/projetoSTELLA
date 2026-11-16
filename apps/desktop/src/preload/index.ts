import { contextBridge } from 'electron';

/** API mínima exposta ao renderer. Cresce fase a fase, sempre passando pelo processo principal. */
const api = {
  appName: 'Stella',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const;

contextBridge.exposeInMainWorld('stella', api);

export type StellaApi = typeof api;
