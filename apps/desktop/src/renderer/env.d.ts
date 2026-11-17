/** Vite: importar um arquivo com `?raw` traz o conteúdo como texto. */
declare module '*?raw' {
  const content: string;
  export default content;
}
