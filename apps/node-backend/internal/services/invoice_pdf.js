// Tax invoice PDF for a paid order. renderInvoicePDF returns the file bytes.
// Prices on the order are GST-inclusive. The invoice shows the tax pulled back out of that price.
// Live plants are nil-rated. Pots, soil, tools, and fertiliser use their own rates.

import {
  createDoc,
  drawLogoPane,
  drawText,
  font,
  pdfContent,
  pdfLeftW,
  pdfLineH,
  pdfMargin,
  pdfPad,
  pdfPageH,
  pdfRightW,
  pdfRowH,
  strokeLine,
  strokeRect,
  wrapLines,
} from "./quotation_pdf.js";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const invoiceCols = [
  { title: "#", width: 10, align: "C" },
  { title: "Description", width: 92, align: "L" },
  { title: "Qty", width: 16, align: "R" },
  { title: "Rate", width: 30, align: "R" },
  { title: "Amount", width: 38, align: "R" },
];

// Amounts are GST-inclusive: taxableValue + taxAmount is the goods subtotal,
// and total is what the customer paid, including delivery.
// Returns the PDF bytes. A draw error ends the document and rethrows.
export async function renderInvoicePDF(inv) {
  const page = createDoc(`Tax Invoice ${inv.number || ""}`);
  try {
    drawInvoice(page, inv);
  } catch (err) {
    page.doc.end();
    await page.done.catch(() => {});
    throw err;
  }
  return page.finish();
}

// The invoice page: title, logo, billed-to block, line table, tax totals, and the notes.
function drawInvoice(page, inv) {
  const { doc } = page;
  const x0 = pdfMargin;
  font(doc, "B", 18);
  drawText(doc, x0, pdfMargin, pdfContent, 9, "Tax Invoice", "C");
  page.y = pdfMargin + 9;

  let y = page.y + 2;
  const headH = drawLogoPane(doc, x0, y, pdfLeftW);
  const rx = x0 + pdfLeftW;
  strokeRect(doc, rx, y, pdfRightW, headH);
  const rows = [
    ["Invoice No.", inv.number || ""],
    ["Date", formatInvoiceDate(inv.date)],
    ["Order ID", `#${inv.orderId ?? ""}`],
  ];
  const rowH = headH / rows.length;
  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    if (i > 0) strokeLine(doc, rx, ry, rx + pdfRightW, ry);
    font(doc, "B", 8.5);
    drawText(doc, rx, ry + 1, pdfRightW * 0.45, pdfLineH, row[0], "L");
    font(doc, "", 8.5);
    drawText(doc, rx + pdfRightW * 0.45, ry + 1, pdfRightW * 0.55, pdfLineH, row[1], "R");
  });
  page.y = y + headH + 3;

  y = page.y;
  const billLines = [inv.customerName || ""];
  for (const line of inv.addressLines || []) billLines.push(line);
  if (inv.customerPhone) billLines.push(`Ph: ${inv.customerPhone}`);
  if (inv.customerEmail) billLines.push(inv.customerEmail);
  const billH = pdfPad * 2 + pdfLineH * (billLines.length + 1);
  strokeRect(doc, x0, y, pdfContent, billH);
  font(doc, "B", 9);
  drawText(doc, x0, y + pdfPad, pdfContent, pdfLineH, "Billed to", "L");
  font(doc, "", 9);
  billLines.forEach((line, i) => {
    drawText(doc, x0, y + pdfPad + pdfLineH * (i + 1), pdfContent, pdfLineH, line, "L");
  });
  page.y = y + billH + 3;

  y = page.y;
  font(doc, "B", 9);
  let cx = x0;
  for (const col of invoiceCols) {
    strokeRect(doc, cx, y, col.width, pdfRowH);
    drawText(doc, cx, y + 1.2, col.width, pdfLineH, col.title, "C");
    cx += col.width;
  }
  page.y = y + pdfRowH;

  font(doc, "", 9);
  (inv.lines || []).forEach((line, i) => {
    const wrapped = wrapLines(doc, line.description || "", invoiceCols[1].width);
    const rowHeight = Math.max(pdfRowH, pdfLineH * wrapped.length + 2 * pdfPad);
    // Leave room for the totals. A line that would collide with them starts a new page.
    if (page.y + rowHeight > pdfPageH - pdfMargin - 40) page.addPage();
    y = page.y;
    const values = ["", "", String(line.quantity ?? ""), formatMoney(line.unitPrice), formatMoney(line.lineTotal)];
    values[0] = String(i + 1);
    cx = x0;
    invoiceCols.forEach((col, ci) => {
      strokeRect(doc, cx, y, col.width, rowHeight);
      if (ci === 1) {
        wrapped.forEach((wl, li) => {
          drawText(doc, cx, y + pdfPad + pdfLineH * li, col.width, pdfLineH, wl, "L");
        });
      } else {
        drawText(doc, cx, y + pdfPad, col.width, pdfLineH, values[ci], col.align);
      }
      cx += col.width;
    });
    page.y = y + rowHeight;
  });

  page.y += 2;
  // Totals sit on the right. Taxable value is the price with GST pulled out.
  const totalsX = x0 + pdfContent * 0.52;
  const totalsW = pdfContent - (totalsX - x0);
  const trs = [{ label: "Taxable value", value: formatMoney(inv.taxableValue), bold: false }];
  const rates = rateEntries(inv.taxByRate);
  for (const [rate, amount] of rates) {
    trs.push({ label: `GST @ ${formatG(rate)}%`, value: formatMoney(amount), bold: false });
  }
  // No tax at all, including a nil-rated plant order, is shown as GST Nil rather than a zero rupee row.
  if (!inv.taxAmount) trs.push({ label: "GST", value: "Nil", bold: false });
  // A zero discount or a free delivery is omitted so the invoice does not show a blank row.
  if (Number(inv.discount) > 0) trs.push({ label: "Discount", value: `-${formatMoney(inv.discount)}`, bold: false });
  if (Number(inv.deliveryFee) > 0) trs.push({ label: "Delivery", value: formatMoney(inv.deliveryFee), bold: false });
  trs.push({ label: "Total paid", value: formatMoney(inv.total), bold: true });
  if (Number(inv.refunded) > 0) trs.push({ label: "Refunded", value: `-${formatMoney(inv.refunded)}`, bold: false });

  y = page.y;
  for (const row of trs) {
    strokeRect(doc, totalsX, y, totalsW, pdfRowH);
    font(doc, row.bold ? "B" : "", row.bold ? 9.5 : 9);
    drawText(doc, totalsX, y + 1.2, totalsW * 0.55, pdfLineH, row.label, "L");
    drawText(doc, totalsX + totalsW * 0.55, y + 1.2, totalsW * 0.45, pdfLineH, row.value, "R");
    y += pdfRowH;
  }
  page.y = y + 4;

  font(doc, "", 8);
  const notes = [
    "Prices are inclusive of GST. Tax shown above is the portion extracted from the inclusive price.",
    "Live plants are nil-rated under GST; pots, soil, tools and fertiliser are taxed at their applicable rates.",
  ];
  if (inv.paymentRef) notes.push(`Payment reference: ${inv.paymentRef}`);
  notes.push("This is a computer-generated invoice and does not require a signature.");
  for (const note of notes) {
    for (const wl of wrapLines(doc, note, pdfContent)) {
      drawText(doc, x0, page.y, pdfContent, pdfLineH, wl, "L");
      page.y += pdfLineH * 0.9;
    }
  }
}

// Always two decimals. The rupee glyph is not in the built-in PDF fonts.
function formatMoney(v) {
  const n = Number(v);
  return `Rs. ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

// A GST percent without forcing two decimals, so 5 stays "5" and 2.5 stays "2.5".
function formatG(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : "0";
}

// Tax amounts keyed by rate, sorted from the lowest rate to the highest. A missing map is an empty list.
function rateEntries(taxByRate) {
  if (!taxByRate) return [];
  const pairs = taxByRate instanceof Map ? [...taxByRate.entries()] : Object.entries(taxByRate);
  return pairs
    .map(([rate, amount]) => [Number(rate), Number(amount)])
    .filter(([rate]) => Number.isFinite(rate))
    .sort((a, b) => a[0] - b[0]);
}

// "26 Oct 2026". An unusable date is blank rather than "Invalid Date".
function formatInvoiceDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
