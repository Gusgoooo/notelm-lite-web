declare module 'pdf-parse' {
  interface PdfData {
    numpages: number;
    text: string;
    info?: Record<string, unknown>;
  }
  function pdfParse(buffer: Buffer): Promise<PdfData>;
  export default pdfParse;
}
