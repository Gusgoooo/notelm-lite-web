async function loadPdfJs() {
  try {
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    try {
      return await import("pdfjs-dist/build/pdf.mjs");
    } catch {
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

export async function extractTextPerPageFromBuffer(
  buffer: Buffer
): Promise<string[]> {
  return extractTextFromPdfData(new Uint8Array(buffer));
}
