// A4 quotation PDF in millimetres. The invoice PDF uses the same drawing helpers.
// quotationPDF returns the file bytes. createDoc starts a page. drawText and wrapLines place the lines.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import {
  chargeValue,
  formatQuantity,
  formatRupees,
  orDash,
  quotationAmount,
  quotationBrand,
  quotationIssuer,
  quotationIssuerPhone,
  quotationIssuerPlace,
  quotationRate,
  supportEmail,
} from "./quotation.js";

const logoPath = fileURLToPath(new URL("./assets/nursery-logo.png", import.meta.url));
const nurseryLogo = readFileSync(logoPath);
const nurseryLogoW = 580;
const nurseryLogoH = 68;

const ptPerMm = 72 / 25.4;

export const pdfMargin = 12;
export const pdfPageW = 210;
export const pdfPageH = 297;
export const pdfContent = pdfPageW - 2 * pdfMargin;
export const pdfLeftW = pdfContent * 0.58;
export const pdfRightW = pdfContent - pdfLeftW;
export const pdfPad = 2;
export const pdfLineH = 4.6;
export const pdfRowH = 7;

const pdfCols = [
  { title: "#", width: 10, align: "C" },
  { title: "Item Code", width: 27, align: "C" },
  { title: "Item name", width: 57, align: "L" },
  { title: "Size", width: 20, align: "C" },
  { title: "Qty.", width: 16, align: "R" },
  { title: "Unit Rate", width: 28, align: "R" },
  { title: "Amount", width: 28, align: "R" },
];

// Millimetres to PDF points. Every coordinate the callers pass is in millimetres.
export function mm(v) {
  return v * ptPerMm;
}

// Renders one quotation. Returns the PDF bytes. A draw error ends the document and rethrows.
export async function quotationPDF(q) {
  const page = createDoc(`Quotation ${q.estimateNo || ""}`);
  try {
    drawQuotation(page, q);
  } catch (err) {
    // Close the document so the write promise settles, then surface the draw error.
    page.doc.end();
    await page.done.catch(() => {});
    throw err;
  }
  return page.finish();
}

// A blank A4 document whose margins are zero so our millimetre layout is the only margin.
// Returns a page object with addPage, ensureSpace, and finish.
export function createDoc(title) {
  const size = [mm(pdfPageW), mm(pdfPageH)];
  const doc = new PDFDocument({
    size,
    margins: { top: 0, left: 0, right: 0, bottom: 0 },
    autoFirstPage: false,
    info: { Title: title, Author: quotationIssuer, Creator: quotationBrand },
  });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const page = {
    doc,
    y: pdfMargin,
    done,
    addPage() {
      doc.addPage({ size, margins: { top: 0, left: 0, right: 0, bottom: 0 } });
      doc.lineWidth(mm(0.25));
      doc.strokeColor("#000000");
      doc.fillColor("#000000");
      this.y = pdfMargin;
    },
    ensureSpace(h) {
      // False means the block fits. True means a new page was started and the caller should repeat a header.
      if (this.y + h <= pdfPageH - pdfMargin) return false;
      this.addPage();
      return true;
    },
    finish() {
      doc.end();
      return done;
    },
  };
  page.addPage();
  return page;
}

// Helvetica, bold when style is "B". The size is remembered so drawText can centre the line.
export function font(doc, style, size) {
  doc.font(style === "B" ? "Helvetica-Bold" : "Helvetica");
  doc.fontSize(size);
  doc._gmSize = size;
}

// One line inside a box. align is "C", "R", or anything else for left. The text is not wrapped here.
export function drawText(doc, xMm, yMm, wMm, hMm, s, align) {
  const size = doc._gmSize || 9;
  const y = mm(yMm) + Math.max(0, (mm(hMm) - size) / 2);
  doc.text(pdfSafe(s), mm(xMm + pdfPad), y, {
    width: Math.max(1, mm(wMm - 2 * pdfPad)),
    height: mm(hMm),
    align: align === "C" ? "center" : align === "R" ? "right" : "left",
    lineBreak: false,
  });
}

// Breaks text into lines that fit the column. A long word is split by character. An empty string is one blank line.
export function wrapLines(doc, s, wMm) {
  const width = Math.max(1, mm(wMm - 2 * pdfPad));
  const text = pdfSafe(s);
  if (!text) return [""];
  const out = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const chunks = [];
      if (doc.widthOfString(word) <= width) chunks.push(word);
      else {
        let buf = "";
        for (const ch of word) {
          const trial = buf + ch;
          if (buf && doc.widthOfString(trial) > width) {
            chunks.push(buf);
            buf = ch;
          } else buf = trial;
        }
        if (buf) chunks.push(buf);
      }
      for (const chunk of chunks) {
        const trial = line ? `${line} ${chunk}` : chunk;
        if (line && doc.widthOfString(trial) > width) {
          out.push(line);
          line = chunk;
        } else line = trial;
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

// A rectangle outline. Coordinates are millimetres.
export function strokeRect(doc, x, y, w, h) {
  doc.rect(mm(x), mm(y), mm(w), mm(h)).stroke();
}

// A straight line. Coordinates are millimetres.
export function strokeLine(doc, x1, y1, x2, y2) {
  doc.moveTo(mm(x1), mm(y1)).lineTo(mm(x2), mm(y2)).stroke();
}

// How tall the logo pane is for a given width, so the estimate box beside it can match.
export function measureHead(width) {
  const logoW = width - 2 * pdfPad;
  const logoH = (logoW * nurseryLogoH) / nurseryLogoW;
  const headH = pdfPad + logoH + 2 + pdfLineH + 1;
  return { logoW, logoH, headH };
}

// The nursery logo and the phone line. The contact size shrinks until it fits the pane.
// Returns the pane height in millimetres.
export function drawLogoPane(doc, x, y, width) {
  const { logoW, logoH, headH } = measureHead(width);
  strokeRect(doc, x, y, width, headH);
  doc.image(nurseryLogo, mm(x + pdfPad), mm(y + pdfPad), { width: mm(logoW), height: mm(logoH) });
  const ty = y + pdfPad + logoH + 1;
  strokeLine(doc, x, ty, x + width, ty);
  const contact = `${quotationIssuerPlace}  |  Ph: ${quotationIssuerPhone}  |  ${supportEmail}`;
  let size = 8.5;
  font(doc, "", size);
  while (size > 6 && doc.widthOfString(contact) > mm(width - 2 * pdfPad)) {
    size -= 0.25;
    font(doc, "", size);
  }
  drawText(doc, x, ty + 0.5, width, pdfLineH, contact, "C");
  return headH;
}

// Draws the quotation onto the page: header, lines, totals, terms, and the signature box.
function drawQuotation(page, q) {
  const { doc } = page;
  const r = q.requester || {};
  const x0 = pdfMargin;
  font(doc, "B", 18);
  drawText(doc, x0, pdfMargin, pdfContent, 9, "Quotation", "C");
  page.y = pdfMargin + 9;

  let y = page.y + 2;
  const headH = drawLogoPane(doc, x0, y, pdfLeftW);
  const rx = x0 + pdfLeftW;
  let labelW = pdfRightW * 0.45;
  const meta = [
    ["Estimate No.", q.estimateNo || ""],
    ["Date", q.date || ""],
    ["Place of supply", orDash(q.placeOfSupply)],
  ];
  let rowH = headH / meta.length;
  for (let i = 0; i < meta.length; i++) {
    const ry = y + i * rowH;
    strokeRect(doc, rx, ry, labelW, rowH);
    strokeRect(doc, rx + labelW, ry, pdfRightW - labelW, rowH);
    font(doc, "", 9);
    drawText(doc, rx, ry, labelW, rowH, meta[i][0], "L");
    font(doc, "B", 9);
    const vl = wrapLines(doc, meta[i][1], pdfRightW - labelW);
    let value = vl[0];
    if (vl.length > 1) value += "...";
    drawText(doc, rx + labelW, ry, pdfRightW - labelW, rowH, value, "L");
  }

  page.y = y + headH + 4;
  font(doc, "B", 9.5);
  drawText(doc, x0 - pdfPad, page.y, pdfContent, pdfLineH, "To:", "L");
  font(doc, "", 9.5);
  const toLines = wrapLines(doc, r.name || "", pdfContent);
  if (r.company) toLines.push(...wrapLines(doc, r.company, pdfContent));
  toLines.push(pdfSafe(`Ph: ${r.phone || ""}`));
  if (r.address) toLines.push(...wrapLines(doc, r.address, pdfContent * 0.7));
  if (r.gstin) toLines.push(pdfSafe(`GSTIN: ${r.gstin}`));
  let ly = page.y + pdfLineH;
  for (const line of toLines) {
    drawText(doc, x0 - pdfPad, ly, pdfContent, pdfLineH, line, "L");
    ly += pdfLineH;
  }

  font(doc, "B", 9.5);
  drawText(doc, x0 - pdfPad, ly + 2, pdfContent, pdfLineH, "Submitting quotation for supplying plants.", "L");
  font(doc, "", 9.5);
  drawText(doc, x0 - pdfPad, ly + 2 + pdfLineH, pdfContent, pdfLineH, "Dear Sir,", "L");
  page.y = ly + 2 + pdfLineH * 2 + 2;

  const header = () => {
    let hx = x0;
    const hy = page.y;
    font(doc, "B", 9);
    for (const c of pdfCols) {
      strokeRect(doc, hx, hy, c.width, pdfRowH);
      drawText(doc, hx, hy, c.width, pdfRowH, c.title, "C");
      hx += c.width;
    }
    page.y = hy + pdfRowH;
  };
  header();

  for (const line of q.lines || []) {
    let name = line.name || "";
    if (line.requested) name += " (requested)";
    const values = [
      String(line.no),
      orDash(line.itemCode),
      name,
      orDash(line.size),
      formatQuantity(line.quantity),
      quotationRate(line.rate),
      quotationAmount(line),
    ];
    font(doc, "", 9);
    const wrapped = values.map((v, i) => wrapLines(doc, v, pdfCols[i].width));
    const n = wrapped.reduce((max, rows) => Math.max(max, rows.length), 1);
    const h = Math.max(pdfRowH, n * pdfLineH + 2);
    if (page.ensureSpace(h)) {
      // A new page needs the column titles again.
      header();
      font(doc, "", 9);
    }
    let cx = x0;
    const cy = page.y;
    for (let i = 0; i < pdfCols.length; i++) {
      const c = pdfCols[i];
      strokeRect(doc, cx, cy, c.width, h);
      const top = cy + (h - wrapped[i].length * pdfLineH) / 2;
      wrapped[i].forEach((text, j) => {
        drawText(doc, cx, top + j * pdfLineH, c.width, pdfLineH, text, c.align);
      });
      cx += c.width;
    }
    page.y = cy + h;
  }

  font(doc, "B", 9.5);
  const words = wrapLines(doc, q.amountInWords || "", pdfLeftW);
  font(doc, "", 9.5);
  const leftH = pdfPad + (2 + words.length + (q.description || []).length) * pdfLineH + 2 + pdfPad;
  const totals = [["Total Cost of Goods", formatRupees(q.goodsTotal)]];
  for (const c of q.charges || []) totals.push([c.label, chargeValue(c)]);
  totals.push(["Total", formatRupees(q.total)]);
  const rightH = totals.length * pdfRowH;
  const boxH = Math.max(leftH, rightH);
  const termsH = pdfPad + (2 + (q.terms || []).length) * pdfLineH + pdfPad;
  const signH = Math.max(termsH, 30);

  page.y += 4;
  page.ensureSpace(boxH + 4 + signH);
  y = page.y;
  strokeRect(doc, x0, y, pdfLeftW, boxH);
  let ty = y + pdfPad;
  font(doc, "", 9.5);
  drawText(doc, x0, ty, pdfLeftW, pdfLineH, "Estimate Amount in Words", "L");
  ty += pdfLineH;
  font(doc, "B", 9.5);
  for (const w of words) {
    drawText(doc, x0, ty, pdfLeftW, pdfLineH, w, "L");
    ty += pdfLineH;
  }
  ty += 2;
  font(doc, "", 9.5);
  drawText(doc, x0, ty, pdfLeftW, pdfLineH, "Description", "L");
  (q.description || []).forEach((d, i) => {
    ty += pdfLineH;
    drawText(doc, x0, ty, pdfLeftW, pdfLineH, `${i + 1}. ${d}`, "L");
  });

  rowH = boxH / totals.length;
  labelW = pdfRightW * 0.6;
  totals.forEach((t, i) => {
    const ry = y + i * rowH;
    const style = i === totals.length - 1 ? "B" : "";
    font(doc, style, 9);
    strokeRect(doc, rx, ry, labelW, rowH);
    strokeRect(doc, rx + labelW, ry, pdfRightW - labelW, rowH);
    drawText(doc, rx, ry, labelW, rowH, t[0], "L");
    drawText(doc, rx + labelW, ry, pdfRightW - labelW, rowH, t[1], "R");
  });

  y += boxH + 4;
  strokeRect(doc, x0, y, pdfLeftW, signH);
  strokeRect(doc, rx, y, pdfRightW, signH);
  ty = y + pdfPad;
  font(doc, "B", 9.5);
  drawText(doc, x0, ty, pdfLeftW, pdfLineH, "Terms and conditions", "L");
  font(doc, "", 9.5);
  ty += pdfLineH;
  drawText(doc, x0, ty, pdfLeftW, pdfLineH, "Thanks for doing business with us!", "L");
  (q.terms || []).forEach((t, i) => {
    ty += pdfLineH;
    drawText(doc, x0, ty, pdfLeftW, pdfLineH, `${i + 1}. ${t}`, "L");
  });
  font(doc, "B", 9.5);
  drawText(doc, rx, y + pdfPad, pdfRightW, pdfLineH, `For ${quotationIssuer}`, "C");
  drawText(doc, rx, y + signH - pdfPad - 2 * pdfLineH, pdfRightW, pdfLineH, "Authorized Signatory", "C");
  font(doc, "", 9.5);
  drawText(doc, rx, y + signH - pdfPad - pdfLineH, pdfRightW, pdfLineH, "(Managing Partner)", "C");
  page.y = y + signH;
}

// Keeps characters the built-in PDF font can draw. Anything else becomes a question mark.
function pdfSafe(s) {
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    else out += "?";
  }
  return out;
}
