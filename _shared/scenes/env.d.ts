// Vite and esbuild (with the `?raw` plugin in the demo's build script) import an SVG file as its text.
declare module '*.svg?raw' {
  const content: string
  export default content
}
