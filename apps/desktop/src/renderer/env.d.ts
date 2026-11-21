/** Vite: importar um arquivo com `?raw` traz o conteúdo como texto. */
declare module '*?raw' {
  const content: string;
  export default content;
}

/** Vite: `?worker&url` empacota o arquivo à parte (com as importações) e traz a URL dele. */
declare module '*?worker&url' {
  const url: string;
  export default url;
}
