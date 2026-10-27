// Bulk-quotation text, HTML, and the rupee totals printed on it.
// The quotation handler calls finalize before the PDF and the staff email.
// Money is rounded to paise. A missing rate is "On request", not zero.

export const quotationIssuer = "Sri Shirdi Sai Nursery";
export const quotationBrand = "Growman";
export const quotationIssuerPlace = "Hyderabad, Telangana";
export const quotationIssuerPhone = "+91 95535 70568, +91 99089 35044";
export const quotationLogoURL = "https://growman.live/quotation/nursery-logo.png";
export const supportEmail = "growman.live@gmail.com";

export const quotationTerms = [
  "Payment 100% Before Dispatch.",
  "Transport & loading/unloading charges as quoted above.",
  "Goods once sold cannot be taken back.",
];

export const quotationDescription = ["100% Payment Before Dispatch"];

const wordOnes = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const wordTens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const qFont = "font-family:Arial,Helvetica,sans-serif;color:#000000;";
const qBox = "border:1px solid #000000;border-collapse:collapse;";
const qTh = "border:1px solid #000000;padding:6px 6px;font-size:12px;font-weight:bold;text-align:center;";
const qTd = "border:1px solid #000000;padding:5px 6px;font-size:12px;";
const qSmall = "font-size:12px;line-height:1.5;";
const qLabelS = "padding:3px 0;font-size:12px;color:#555555;width:90px;vertical-align:top;";
const qValueS = "padding:3px 0;font-size:13px;color:#000000;";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Adds a titled block of label/value rows to the staff email. Blank values are dropped.
// Returns the same meta object. A section with nothing left to show is not added.
export function addSection(meta, title, ...groups) {
  if (!meta.sections) meta.sections = [];
  const kept = [];
  for (const d of groups.flat()) {
    const value = String(d?.value ?? "").trim();
    if (value) kept.push({ label: d.label, value });
  }
  if (kept.length) meta.sections.push({ title, details: kept });
  return meta;
}

// The attachment name. estimateNo is the number staff already assigned.
export function quotationPDFFilename(q) {
  return `Quotation-${q.estimateNo}.pdf`;
}

// A short item code from the product id and the size id, each padded to four digits.
export function quotationItemCode(productID, sizeID) {
  return `GM${pad4(productID)}${pad4(sizeID)}`;
}

// Fills line numbers, line amounts, goods total, charges, and the amount in words.
// Call this before rendering the PDF or the email. Returns the same quotation.
export function finalize(q) {
  q.goodsTotal = 0;
  q.totalUnits = 0;
  const lines = q.lines || [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    line.no = i + 1;
    line.amount = roundMoney(Number(line.rate) * Number(line.quantity));
    q.goodsTotal += line.amount;
    q.totalUnits += Math.trunc(Number(line.quantity) || 0);
  }
  q.goodsTotal = roundMoney(q.goodsTotal);
  // Charges that already have an amount are added. A charge still "to be quoted" has no amount and is skipped.
  q.total = q.goodsTotal;
  for (const c of q.charges || []) {
    if (c.amount != null) q.total += Number(c.amount);
  }
  q.total = roundMoney(q.total);
  q.amountInWords = rupeesInWords(q.total);
  q.description = quotationDescription.slice();
  q.terms = quotationTerms.slice();
  q.issuer = quotationIssuer;
  q.issuerAddress = quotationIssuerPlace;
  q.issuerPhone = quotationIssuerPhone;
  return q;
}

// True when transport or another charge was requested but has no price yet.
// The handler uses this to avoid telling the shopper the total is final.
export function pendingCharges(q) {
  for (const c of q.charges || []) {
    if (c.requested && c.amount == null) return true;
  }
  return false;
}

// A quantity with thousands separators and no decimals. A bad number is 0.
export function formatQuantity(n) {
  return groupThousands(Math.trunc(Number(n) || 0));
}

// "Rs. 1,234" or "Rs. 1,234.50". Paise are shown only when they are not zero. The sign is kept.
export function formatRupees(v) {
  const cents = Math.abs(moneyCents(v));
  const whole = Math.trunc(cents / 100);
  const paise = cents % 100;
  const sign = moneyCents(v) < 0 ? "-" : "";
  if (paise === 0) return `Rs. ${sign}${groupThousands(whole)}`;
  return `Rs. ${sign}${groupThousands(whole)}.${String(paise).padStart(2, "0")}`;
}

// "One Thousand Two Hundred Rupees only", with paise when the amount is not a whole rupee.
export function rupeesInWords(v) {
  const cents = Math.abs(moneyCents(v));
  const whole = Math.trunc(cents / 100);
  const paise = cents % 100;
  let out = `${numberInWords(whole)} Rupees`;
  if (paise > 0) out += ` and ${wordsBelow100(paise)} Paise`;
  return `${out} only`;
}

// The printed value, or a dash when the shopper left it blank.
export function orDash(s) {
  const t = String(s ?? "").trim();
  return t ? t : "-";
}

// A unit rate. Zero or missing means the nursery has not priced that line yet.
export function quotationRate(v) {
  if (!(Number(v) > 0)) return "On request";
  return formatRupees(v);
}

// The line amount, or a dash when the rate is not a real price.
export function quotationAmount(line) {
  if (!(Number(line?.rate) > 0)) return "-";
  return formatRupees(line.amount);
}

// How a transport or loading charge is printed: a price, "To be quoted", or "Not required".
export function chargeValue(c) {
  if (c?.amount != null) return formatRupees(c.amount);
  if (c?.requested) return "To be quoted";
  return "Not required";
}

// Plain-text body of the staff email, including the quotation and who submitted it.
export function quotationText(q, meta) {
  const r = q.requester || {};
  const lines = [];
  lines.push(`NEW QUOTATION ENQUIRY — ${q.estimateNo}`);
  lines.push("");
  lines.push(`Name: ${r.name ?? ""}`);
  lines.push(`Phone: ${r.phone ?? ""}`);
  lines.push(`Address: ${orDash(r.address)}`);
  if (r.email) lines.push(`Email: ${r.email}`);
  if (r.notes) lines.push(`Notes: ${r.notes}`);
  lines.push("");
  lines.push("Quotation");
  lines.push(`${q.issuer}, ${q.issuerAddress} · ${q.issuerPhone}`);
  lines.push(`Estimate No. ${q.estimateNo}`);
  lines.push(`Date ${q.date}`);
  lines.push(`Place of supply ${orDash(q.placeOfSupply)}`);
  lines.push("");
  lines.push("To:");
  lines.push(String(r.name ?? ""));
  lines.push(`Ph: ${r.phone ?? ""}`);
  if (r.address) lines.push(String(r.address));
  lines.push("");
  lines.push("Submitting quotation for supplying plants.");
  lines.push("Dear Sir,");
  lines.push("");
  lines.push("# | Item Code | Item name | Size | Qty. | Unit Rate | Amount");
  for (const l of q.lines || []) {
    let name = l.name ?? "";
    if (l.requested) name += " (requested)";
    lines.push(
      `${l.no} | ${orDash(l.itemCode)} | ${name} | ${orDash(l.size)} | ${formatQuantity(l.quantity)} | ${quotationRate(l.rate)} | ${quotationAmount(l)}`,
    );
  }
  lines.push("");
  lines.push("Estimate Amount in Words");
  lines.push(q.amountInWords ?? "");
  lines.push("");
  lines.push("Description");
  (q.description || []).forEach((d, i) => lines.push(`${i + 1}. ${d}`));
  lines.push("");
  lines.push(`Total Cost of Goods ${formatRupees(q.goodsTotal)}`);
  for (const c of q.charges || []) lines.push(`${c.label} ${chargeValue(c)}`);
  lines.push(`Total ${formatRupees(q.total)}`);
  lines.push("");
  lines.push("Terms and conditions");
  lines.push("Thanks for doing business with us!");
  (q.terms || []).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  lines.push("");
  lines.push(`For ${q.issuer}`);
  lines.push("Authorized Signatory");
  lines.push("(Managing Partner)");
  lines.push("");
  const submitted = submittedDate(meta);
  lines.push(`Submitted: ${formatRFC1123(submitted)}`);
  lines.push(`User ID: ${orDash(meta?.userId)}`);
  lines.push(`IP: ${orDash(meta?.ip)}`);
  lines.push(`User-Agent: ${orDash(meta?.userAgent)}`);
  for (const section of meta?.sections || []) {
    lines.push("");
    lines.push(String(section.title ?? "").toUpperCase());
    for (const d of section.details || []) lines.push(`${d.label}: ${d.value}`);
  }
  return lines.join("\n");
}

// HTML body of the same staff email, with call and WhatsApp links and the quotation table.
export function quotationHTML(q, meta) {
  const r = q.requester || {};
  const b = [];
  b.push(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quotation</title></head>`,
  );
  b.push(`<body style="margin:0;padding:0;background:#f3f4f6;${qFont}">`);
  b.push(
    `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Quotation enquiry ${escapeHTML(q.estimateNo)} from ${escapeHTML(r.name)}</span>`,
  );
  b.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:20px 10px;"><tr><td align="center">`,
  );
  b.push(`<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;">`);
  b.push(`<tr><td style="background:#ffffff;border:1px solid #d1d5db;padding:14px 16px;">`);
  b.push(`<p style="margin:0 0 8px;font-size:15px;font-weight:bold;">New quotation enquiry · ${escapeHTML(q.estimateNo)}</p>`);
  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`);
  const row = (label, value) => {
    b.push(`<tr><td style="${qLabelS}">${label}</td><td style="${qValueS}">${value}</td></tr>`);
  };
  row("Name", esc(r.name));
  row("Phone", `<a href="tel:${escapeHTML(r.phone)}" style="color:#000000;">${escapeHTML(r.phone)}</a>`);
  row("Address", esc(r.address));
  if (r.email) row("Email", escapeHTML(r.email));
  if (r.notes) row("Notes", escapeHTML(r.notes).replaceAll("\n", "<br>"));
  row("Summary", `${(q.lines || []).length} items · ${formatQuantity(q.totalUnits)} units · ${formatRupees(q.total)}`);
  row(
    "Submitted",
    escapeHTML(`${formatQuotationStamp(submittedDate(meta))} · IP ${orDash(meta?.ip)}`),
  );
  b.push(`</table>`);
  b.push(
    `<p style="margin:10px 0 0;font-size:12px;"><a href="tel:+91${escapeHTML(r.phone)}" style="color:#000000;">Call</a> &nbsp;|&nbsp; <a href="https://wa.me/91${escapeHTML(r.phone)}" style="color:#000000;">WhatsApp</a>`,
  );
  if (r.address) {
    b.push(
      ` &nbsp;|&nbsp; <a href="https://www.google.com/maps/search/?api=1&amp;query=${escapeHTML(queryEscape(r.address))}" style="color:#000000;">Open address in Maps</a>`,
    );
  }
  b.push(` &nbsp;|&nbsp; PDF attached</p>`);
  b.push(`</td></tr><tr><td style="height:14px;"></td></tr>`);

  if ((meta?.sections || []).length > 0) {
    b.push(`<tr><td style="background:#ffffff;border:1px solid #d1d5db;padding:14px 16px;">`);
    b.push(`<p style="margin:0 0 6px;font-size:15px;font-weight:bold;">Enquiry details</p>`);
    for (const section of meta.sections) {
      b.push(
        `<p style="margin:10px 0 2px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#555555;">${escapeHTML(section.title)}</p>`,
      );
      b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`);
      for (const d of section.details || []) {
        b.push(
          `<tr><td style="border-bottom:1px solid #eeeeee;padding:4px 8px 4px 0;font-size:12px;color:#555555;width:140px;vertical-align:top;">${escapeHTML(d.label)}</td><td style="border-bottom:1px solid #eeeeee;padding:4px 0;font-size:12px;color:#000000;word-break:break-word;">${escapeHTML(d.value)}</td></tr>`,
        );
      }
      b.push(`</table>`);
    }
    b.push(`</td></tr><tr><td style="height:14px;"></td></tr>`);
  }

  b.push(`<tr><td style="background:#ffffff;padding:24px 20px;">`);
  b.push(`<p style="margin:0 0 10px;text-align:center;font-size:22px;font-weight:bold;">Quotation</p>`);
  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${qBox}"><tr>`);
  b.push(
    `<td style="border:1px solid #000000;padding:6px 8px;vertical-align:middle;width:58%;"><img src="${quotationLogoURL}" alt="${quotationIssuer}" width="560" style="display:block;width:100%;height:auto;border:0;"><p style="margin:4px 0 0;padding-top:4px;border-top:1px solid #000000;font-size:10.5px;line-height:1.3;text-align:center;white-space:nowrap;">${quotationIssuerPlace} &nbsp;|&nbsp; Ph: ${quotationIssuerPhone} &nbsp;|&nbsp; ${supportEmail}</p></td>`,
  );
  b.push(
    `<td style="border:1px solid #000000;padding:0;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`,
  );
  for (const [label, value] of [
    ["Estimate No.", q.estimateNo],
    ["Date", q.date],
    ["Place of supply", orDash(q.placeOfSupply)],
  ]) {
    b.push(`<tr><td style="${qTd}">${label}</td><td style="${qTd}font-weight:bold;">${escapeHTML(value)}</td></tr>`);
  }
  b.push(`</table></td></tr></table>`);

  const addressHTML = r.address ? `<br>${escapeHTML(r.address)}` : "";
  b.push(
    `<p style="margin:14px 0 2px;font-size:12px;line-height:1.5;"><strong>To:</strong><br>${escapeHTML(r.name)}<br>Ph: ${escapeHTML(r.phone)}${addressHTML}</p>`,
  );
  b.push(`<p style="margin:8px 0 4px;font-size:12px;font-weight:bold;">Submitting quotation for supplying plants.</p>`);
  b.push(`<p style="margin:0 0 10px;font-size:12px;">Dear Sir,</p>`);

  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${qBox}">`);
  b.push(
    `<tr><th style="${qTh}">#</th><th style="${qTh}">Item Code</th><th style="${qTh}">Item name</th><th style="${qTh}">Size</th><th style="${qTh}">Qty.</th><th style="${qTh}">Unit Rate</th><th style="${qTh}">Amount</th></tr>`,
  );
  for (const l of q.lines || []) {
    let name = escapeHTML(l.name);
    if (l.requested) name += ` <span style="font-size:10px;color:#555555;">(requested)</span>`;
    b.push(
      `<tr><td style="${qTd}text-align:center;">${l.no}</td><td style="${qTd}text-align:center;">${esc(l.itemCode)}</td><td style="${qTd}">${name}</td><td style="${qTd}text-align:center;">${esc(l.size)}</td><td style="${qTd}text-align:right;">${formatQuantity(l.quantity)}</td><td style="${qTd}text-align:right;white-space:nowrap;">${quotationRate(l.rate)}</td><td style="${qTd}text-align:right;white-space:nowrap;">${quotationAmount(l)}</td></tr>`,
    );
  }
  b.push(`</table>`);

  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${qBox}margin-top:12px;"><tr>`);
  b.push(
    `<td style="border:1px solid #000000;padding:8px;vertical-align:top;${qSmall}"><p style="margin:0;">Estimate Amount in Words</p><p style="margin:2px 0 10px;font-weight:bold;">${escapeHTML(q.amountInWords)}</p><p style="margin:0;">Description</p>`,
  );
  (q.description || []).forEach((d, i) => {
    b.push(`<p style="margin:0;">${i + 1}. ${escapeHTML(d)}</p>`);
  });
  b.push(
    `</td><td style="border:1px solid #000000;padding:0;vertical-align:top;width:42%;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`,
  );
  const total = (label, value, bold) => {
    const w = bold ? "font-weight:bold;" : "";
    b.push(`<tr><td style="${qTd}${w}">${label}</td><td style="${qTd}text-align:right;white-space:nowrap;${w}">${value}</td></tr>`);
  };
  total("Total Cost of Goods", formatRupees(q.goodsTotal), false);
  for (const c of q.charges || []) total(escapeHTML(c.label), chargeValue(c), false);
  total("Total", formatRupees(q.total), true);
  b.push(`</table></td></tr></table>`);

  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${qBox}margin-top:12px;"><tr>`);
  b.push(
    `<td style="border:1px solid #000000;padding:8px;vertical-align:top;${qSmall}"><p style="margin:0 0 4px;font-weight:bold;">Terms and conditions</p><p style="margin:0;">Thanks for doing business with us!</p>`,
  );
  (q.terms || []).forEach((t, i) => {
    b.push(`<p style="margin:0;">${i + 1}. ${escapeHTML(t)}</p>`);
  });
  b.push(
    `</td><td style="border:1px solid #000000;padding:8px;vertical-align:top;width:42%;${qSmall}"><p style="margin:0;text-align:center;font-weight:bold;">For ${quotationIssuer}</p><p style="margin:34px 0 0;text-align:center;font-weight:bold;">Authorized Signatory</p><p style="margin:0;text-align:center;">(Managing Partner)</p></td>`,
  );
  b.push(`</tr></table>`);
  b.push(`</td></tr>`);
  b.push(
    `<tr><td style="padding:10px 4px;font-size:11px;color:#6b7280;">${quotationBrand} · ${quotationIssuerPlace}. Call ${escapeHTML(r.name)} back on ${escapeHTML(r.phone)}.</td></tr>`,
  );
  b.push(`</table></td></tr></table></body></html>`);
  return b.join("");
}

// Four digits, with a minus sign kept in front of a negative id. Used inside item codes.
function pad4(n) {
  const v = Math.trunc(Number(n) || 0);
  const sign = v < 0 ? "-" : "";
  return sign + String(Math.abs(v)).padStart(4, "0");
}

// Rupees as integer paise, so 0.1 + 0.2 does not become a long float on the quotation.
function moneyCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

// Back to rupees, rounded to the nearest paise.
function roundMoney(v) {
  return moneyCents(v) / 100;
}

// 1200 becomes "1,200". The sign is kept.
function groupThousands(n) {
  const neg = n < 0;
  const s = String(Math.abs(Math.trunc(n)));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return neg ? `-${out}` : out;
}

// English words for 0 through 99. Used for paise and as part of the larger amount.
function wordsBelow100(n) {
  n = Math.trunc(n);
  if (n < 20) return wordOnes[n];
  if (n % 10 === 0) return wordTens[Math.trunc(n / 10)];
  return `${wordTens[Math.trunc(n / 10)]} ${wordOnes[n % 10]}`;
}

// Indian grouping: crore, lakh, thousand, hundred. Zero is the word Zero, not an empty string.
function numberInWords(n) {
  n = Math.trunc(n);
  if (n === 0) return "Zero";
  const parts = [];
  if (n >= 10000000) {
    parts.push(`${numberInWords(Math.trunc(n / 10000000))} Crore`);
    n %= 10000000;
  }
  if (n >= 100000) {
    parts.push(`${wordsBelow100(Math.trunc(n / 100000))} Lakh`);
    n %= 100000;
  }
  if (n >= 1000) {
    parts.push(`${wordsBelow100(Math.trunc(n / 1000))} Thousand`);
    n %= 1000;
  }
  if (n >= 100) {
    parts.push(`${wordOnes[Math.trunc(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n > 0) {
    if (parts.length) parts.push("and");
    parts.push(wordsBelow100(n));
  }
  return parts.join(" ");
}

// HTML for a cell, with a dash when the value is blank.
function esc(s) {
  return escapeHTML(orDash(s));
}

// Escapes shopper text before it is placed in the staff email.
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}

// Query encoding for the maps link on the shopper's address.
function queryEscape(s) {
  const bytes = Buffer.from(String(s ?? ""), "utf8");
  let out = "";
  for (const b of bytes) {
    if (b === 0x20) out += "+";
    else if (
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b === 0x2d ||
      b === 0x2e ||
      b === 0x5f
    ) {
      out += String.fromCharCode(b);
    } else out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// When the enquiry was submitted. A missing value becomes an invalid date, which the formatter still prints from.
function submittedDate(meta) {
  const s = meta?.submitted;
  if (s instanceof Date) return s;
  return new Date(s);
}

// A mail-style date with the server's short timezone name. Used at the bottom of the plain-text email.
function formatRFC1123(d) {
  const pad = (n) => String(n).padStart(2, "0");
  let tz = "UTC";
  try {
    tz =
      new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
        .formatToParts(d)
        .find((p) => p.type === "timeZoneName")?.value || "UTC";
  } catch {
    /* keep UTC */
  }
  return `${weekdays[d.getDay()]}, ${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tz}`;
}

// Day-month-year and time for the HTML "Submitted" row.
function formatQuotationStamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
