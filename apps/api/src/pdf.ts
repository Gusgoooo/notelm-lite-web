/**
 * Extract text per page from a PDF buffer using pdfjs-dist (server-side).
 */
import * as fs from "node:fs";

export async function loadPdfJs() {
  // Prefer ESM builds in modern pdfjs-dist
  try {
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (_) {
    try {
      return await import("pdfjs-dist/build/pdf.mjs");
    } catch (e) {
      // Last resort for older versions
      return await import("pdfjs-dist/legacy/build/pdf.js");
    }
  }
}

async function extractTextFromPdfData(data: Uint8Array): Promise<string[]> {
  const pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const numPages = doc.numPages;
  const texts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    texts.push(text);
  }
  return texts;
}

export async function extractTextPerPage(pdfPath: string): Promise<string[]> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  return extractTextFromPdfData(data);
}

export async function extractTextPerPageFromBuffer(buffer: Buffer): Promise<string[]> {
  return extractTextFromPdfData(new Uint8Array(buffer));
}
