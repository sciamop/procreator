declare module 'lz4js' {
  export function decompressBlock(source: Uint8Array, destination: Uint8Array, start: number, length: number, outputOffset: number): number;
}
