// Tax invoices for paid Growman orders.
//
// Shop prices already include GST. This file pulls that tax back out of the
// inclusive price, gives the order a GRW invoice number for the Indian
// financial year, and can download the PDF, email it, or roll a month up
// for the GST report. A customer can fetch their own invoice. An admin can
// fetch any invoice and email it.

import PDFDocument from "pdfkit";
import { Op, QueryTypes } from "sequelize";
import { json, error } from "../../pkg/httpjson/httpjson.js";
import { requireUser, isAdminRole } from "../auth/jwt.js";
import { Order, OrderItem, Product } from "../models/index.js";
import { renderEmail, escapeHtml } from "./auth.js";

// Live plants are nil-rated, so a product with no GST rate contributes no tax.
const defaultGSTRate = 0;
// Every invoice number starts with this series, then the financial year.
const invoiceSeriesPrefix = "GRW";

// Money on the invoice is kept to two decimal places (paise).
function round2(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

// Order ids in the URL must be a plain positive integer.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw ?? ""))) return null;
  const parsedId = Number(raw);
  if (!Number.isSafeInteger(parsedId)) return null;
  return parsedId;
}

// Indian financial year runs April to March. January through March belong to the year that started the previous April.
function financialYear(when) {
  let year = when.getFullYear();
  if (when.getMonth() < 3) year--;
  const next = String((year + 1) % 100).padStart(2, "0");
  return `${year}-${next}`;
}

// Work out taxable value and GST for the lines on an order.
// Each line price already includes GST, so the tax is the portion taken back out of that price.
export async function computeOrderTax(items, transaction) {
  const out = { taxableValue: 0, taxAmount: 0, byRate: {} };
  // An order with no lines has nothing to tax.
  if (!items?.length) return out;
  // GST rate lives on the product, not on the order line.
  const productIds = items.map((item) => item.productId);
  const products = await Product.findAll({
    attributes: ["id", "gstRate"],
    where: { id: productIds },
    transaction,
  });
  const rateByProduct = new Map(products.map((product) => [Number(product.id), Number(product.gstRate || 0)]));
  for (const item of items) {
    // A product that has disappeared still uses the nil rate.
    let rate = rateByProduct.has(Number(item.productId)) ? rateByProduct.get(Number(item.productId)) : defaultGSTRate;
    if (!rateByProduct.has(Number(item.productId))) rate = defaultGSTRate;
    const lineTotal = Number(item.price) * Number(item.quantity);
    let taxable = lineTotal;
    let tax = 0;
    // Inclusive price: taxable value is the price divided by (1 + rate). The rest is GST.
    if (rate > 0) {
      taxable = lineTotal / (1 + rate / 100);
      tax = lineTotal - taxable;
    }
    out.taxableValue += taxable;
    out.taxAmount += tax;
    // The PDF groups GST by rate, for example 18% pots separately from 5% tools.
    if (tax > 0) out.byRate[rate] = (out.byRate[rate] || 0) + tax;
  }
  out.taxableValue = round2(out.taxableValue);
  out.taxAmount = round2(out.taxAmount);
  return out;
}

// Give a paid order its invoice number and freeze the tax figures on the order row.
// Calling this again does nothing once a number is already stored.
export async function assignInvoiceNumber(tx, order) {
  if (order.invoiceNumber) return;
  const now = new Date();
  const fy = financialYear(now);
  // The next number is one more than how many invoices already exist in this financial year.
  const used = await Order.count({
    where: { invoiceNumber: { [Op.like]: `${invoiceSeriesPrefix}/${fy}/%` } },
    transaction: tx,
  });
  const number = `${invoiceSeriesPrefix}/${fy}/${String(Number(used) + 1).padStart(6, "0")}`;
  // Tax needs the line items. Load them when the order object did not already include them.
  let items = order.items || [];
  if (!items.length) items = await OrderItem.findAll({ where: { orderId: order.id }, transaction: tx });
  const tax = await this.computeOrderTax(items, tx);
  // Number, date, and tax totals are saved together inside the caller's transaction.
  await Order.update(
    {
      invoiceNumber: number,
      invoiceDate: now,
      taxableValue: tax.taxableValue,
      taxAmount: tax.taxAmount,
    },
    { where: { id: order.id }, silent: true, transaction: tx },
  );
  order.invoiceNumber = number;
  order.invoiceDate = now;
  order.taxableValue = tax.taxableValue;
  order.taxAmount = tax.taxAmount;
}

// The address printed under "Billed to". Structured fields win; the old single shipping string is the fallback.
function addressLines(order) {
  const lines = [];
  if (order.addressLine) lines.push(order.addressLine);
  const cityState = [order.city, order.state].map((part) => String(part ?? "").trim()).filter(Boolean).join(", ");
  if (cityState) lines.push(cityState);
  if (order.pincode) lines.push(order.pincode);
  if (!lines.length && order.shippingAddress) lines.push(order.shippingAddress);
  return lines;
}

// Rupee amounts on the PDF are labelled "Rs." with two decimal places.
function formatMoney(amount) {
  return `Rs. ${Number(amount).toFixed(2)}`;
}

// Invoice dates read like "26 Oct 2026".
function formatInvoiceDate(d) {
  const dt = d ? new Date(d) : new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Turn a stored order into the PDF bytes the customer downloads or receives by email.
export async function buildInvoicePDF(order) {
  // Tax is computed again from the product rates so the PDF matches the current catalog rates.
  const tax = await this.computeOrderTax(order.items || []);
  const lines = (order.items || []).map((item) => ({
    description: item.name,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: round2(Number(item.price) * Number(item.quantity)),
  }));
  const doc = {
    number: order.invoiceNumber,
    date: order.invoiceDate || new Date(),
    orderId: Number(order.id),
    customerName: order.customerName || "",
    customerEmail: order.customerEmail || "",
    customerPhone: order.customerPhone || "",
    addressLines: addressLines(order),
    lines,
    subtotal: round2(order.subtotal),
    deliveryFee: round2(order.deliveryFee),
    discount: round2(order.discountTotal),
    taxableValue: tax.taxableValue,
    taxAmount: tax.taxAmount,
    taxByRate: tax.byRate,
    total: round2(order.amount),
    refunded: round2(order.refundedAmount),
    paymentRef: order.razorpayPaymentId || "",
  };
  return renderInvoicePDF(doc);
}

// Draw the A4 tax invoice. The buffer is the finished PDF.
function renderInvoicePDF(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // Shop letterhead.
    doc.fontSize(18).text("Tax Invoice", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(9).text("Hyderabad, Telangana  |  Ph: +91 95535 70568, +91 99089 35044  |  growman.live@gmail.com", { align: "center" });
    doc.moveDown(0.6);
    // Invoice number, date, and the shop order id.
    doc.fontSize(10);
    doc.text(`Invoice No.    ${inv.number || ""}`);
    doc.text(`Date           ${formatInvoiceDate(inv.date)}`);
    doc.text(`Order ID       #${inv.orderId}`);
    doc.moveDown(0.6);
    // Who is being billed, including phone and email when we have them.
    doc.font("Helvetica-Bold").text("Billed to");
    doc.font("Helvetica");
    const billed = [inv.customerName, ...inv.addressLines];
    if (inv.customerPhone) billed.push("Ph: " + inv.customerPhone);
    if (inv.customerEmail) billed.push(inv.customerEmail);
    for (const line of billed) doc.text(line);
    doc.moveDown(0.6);
    // One row per product: description, quantity, rate, and line amount.
    doc.font("Helvetica-Bold").text("#    Description                         Qty        Rate            Amount");
    doc.font("Helvetica");
    inv.lines.forEach((line, i) => {
      doc.text(`${i + 1}    ${line.description}    ${line.quantity}    ${formatMoney(line.unitPrice)}    ${formatMoney(line.lineTotal)}`);
    });
    doc.moveDown(0.8);
    // Taxable value, then one GST line per rate. Nil when the whole order is zero-rated.
    doc.text(`Taxable value    ${formatMoney(inv.taxableValue)}`);
    const rates = Object.keys(inv.taxByRate || {}).map(Number).sort((a, b) => a - b);
    for (const rate of rates) {
      doc.text(`GST @ ${Number(rate)}%    ${formatMoney(inv.taxByRate[rate])}`);
    }
    if (!inv.taxAmount) doc.text("GST    Nil");
    // Discount and delivery are shown only when they are more than zero.
    if (inv.discount > 0) doc.text(`Discount    -${formatMoney(inv.discount)}`);
    if (inv.deliveryFee > 0) doc.text(`Delivery    ${formatMoney(inv.deliveryFee)}`);
    doc.font("Helvetica-Bold").text(`Total paid    ${formatMoney(inv.total)}`);
    doc.font("Helvetica");
    if (inv.refunded > 0) doc.text(`Refunded    -${formatMoney(inv.refunded)}`);
    doc.moveDown(0.8);
    // The footer explains inclusive pricing and that live plants are nil-rated.
    doc.fontSize(8);
    doc.text("Prices are inclusive of GST. Tax shown above is the portion extracted from the inclusive price.");
    doc.text("Live plants are nil-rated under GST; pots, soil, tools and fertiliser are taxed at their applicable rates.");
    if (inv.paymentRef) doc.text("Payment reference: " + inv.paymentRef);
    doc.text("This is a computer-generated invoice and does not require a signature.");
    doc.end();
  });
}

// Download the invoice PDF.
// A long public token on the query string opens the order without a login.
// Otherwise the caller must be signed in: an admin sees any order, a customer only their own.
export async function getOrderInvoice(req, res) {
  const idParam = req.params.id;
  const token = String(req.query?.token ?? "").trim();
  const include = [{ model: OrderItem, as: "items" }];
  let order;
  try {
    if (token) {
      // A short token is rejected so a guess cannot open someone else's invoice.
      if (token.length < 32) {
        error(res, 400, "invalid order token");
        return;
      }
      order = await Order.findOne({ where: { publicToken: token }, include });
    } else {
      if (!req.user) {
        error(res, 401, "sign in to download this invoice");
        return;
      }
      const where = { id: idParam };
      // Admin check: staff can download any order. A customer is limited to orders they placed.
      if (!isAdminRole(req.user.role)) where.userId = req.user.userId;
      order = await Order.findOne({ where, include });
    }
  } catch {
    error(res, 404, "order not found");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }
  // An invoice exists once the order is paid, or once any refund has been recorded against it.
  if (order.paymentStatus !== "paid" && Number(order.refundedAmount || 0) === 0) {
    error(res, 409, "an invoice is only available once the order is paid");
    return;
  }
  // Older paid orders may not have a number yet. Assign one before drawing the PDF.
  if (!order.invoiceNumber) {
    try {
      await this.sequelize.transaction(async (tx) => {
        await this.assignInvoiceNumber(tx, order);
      });
    } catch (err) {
      console.log(`[INVOICE] backfill for order ${order.id}: ${err.message}`);
      error(res, 500, "failed to prepare invoice");
      return;
    }
  }
  let pdf;
  try {
    pdf = await this.buildInvoicePDF(order);
  } catch (err) {
    console.log(`[INVOICE] render order ${order.id}: ${err.message}`);
    error(res, 500, "failed to generate invoice");
    return;
  }
  // Slashes in GRW/2026-27/000001 become dashes so the filename is safe.
  const filename = String(order.invoiceNumber).replaceAll("/", "-");
  res.status(200);
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `inline; filename="invoice-${filename}.pdf"`);
  res.set("Cache-Control", "private, max-age=0, no-store");
  res.send(pdf);
}

// Email the PDF to the customer. The HTML body is escaped so a name cannot inject markup.
export async function sendInvoiceEmail(to, name, orderId, invoiceNumber, pdf) {
  const text = `Hi ${name},\n\nYour tax invoice ${invoiceNumber} for order #${orderId} is attached.\n\n— Growman`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Your tax invoice</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHtml(name)} — invoice <strong style="color:#111827;">${escapeHtml(invoiceNumber)}</strong> for order #${orderId} is attached as a PDF.</p>
<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">Keep it for your records. If you need it reissued with GSTIN details, reply to this email.</p>`;
  await this.sendTransactionalEmail(
    to,
    `Tax invoice ${invoiceNumber} for order #${orderId}`,
    text,
    renderEmail(`Tax invoice ${invoiceNumber} for order #${orderId}`, inner),
    [{ filename: `invoice-${invoiceNumber}.pdf`, contentType: "application/pdf", data: pdf }],
  );
}

// Admin-only: prepare the invoice if needed, then email the PDF to the address stored on the order.
export async function emailOrderInvoice(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  // Admin check: only staff can push an invoice email.
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order ID");
    return;
  }
  let order;
  try {
    order = await Order.findOne({ where: { id: orderId }, include: [{ model: OrderItem, as: "items" }] });
  } catch {
    error(res, 404, "order not found");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }
  if (!order.customerEmail) {
    error(res, 409, "order has no customer email");
    return;
  }
  // Same numbering step as the download path, so the email and the PDF share one number.
  if (!order.invoiceNumber) {
    try {
      await this.sequelize.transaction(async (tx) => {
        await this.assignInvoiceNumber(tx, order);
      });
    } catch {
      error(res, 500, "failed to prepare invoice");
      return;
    }
  }
  let pdf;
  try {
    pdf = await this.buildInvoicePDF(order);
  } catch (err) {
    console.log(`[INVOICE] render: ${err.message}`);
    error(res, 500, "failed to generate invoice");
    return;
  }
  try {
    await this.sendInvoiceEmail(order.customerEmail, order.customerName, Number(order.id), order.invoiceNumber, pdf);
  } catch (err) {
    console.log(`[INVOICE] email: ${err.message}`);
    error(res, 502, "failed to send invoice email");
    return;
  }
  json(res, 200, { success: true, invoiceNumber: order.invoiceNumber });
}

// Admin-only monthly GST summary. Month defaults to the current calendar month, written YYYY-MM.
export async function exportGSTReport(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  let month = String(req.query?.month ?? "").trim();
  if (!month) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    error(res, 400, "month must be formatted YYYY-MM");
    return;
  }
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) {
    error(res, 400, "month must be formatted YYYY-MM");
    return;
  }
  // The window is [first of month, first of next month) in UTC.
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  let rows;
  try {
    // Only orders that already have an invoice number, dated inside the month.
    rows = await this.sequelize.query(
      `SELECT invoice_number, invoice_date, id AS order_id, customer_name, state, pincode,
              taxable_value, tax_amount, amount AS total, refunded_amount, payment_status
       FROM orders
       WHERE invoice_number <> '' AND invoice_date >= $1 AND invoice_date < $2 AND deleted_at IS NULL
       ORDER BY invoice_number ASC`,
      { bind: [start, end], type: QueryTypes.SELECT },
    );
  } catch (err) {
    console.log(`[INVOICE] GST export: ${err.message}`);
    error(res, 500, "failed to build report");
    return;
  }
  const invoices = rows.map((row) => ({
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    orderId: Number(row.order_id),
    customerName: row.customer_name,
    state: row.state,
    pincode: row.pincode,
    taxableValue: Number(row.taxable_value || 0),
    taxAmount: Number(row.tax_amount || 0),
    total: Number(row.total || 0),
    refundedAmount: Number(row.refunded_amount || 0),
    paymentStatus: row.payment_status,
  }));
  // Totals are the sum of every invoice in the month, including refunded amounts.
  const totals = { taxableValue: 0, taxAmount: 0, total: 0, refundedAmount: 0 };
  for (const row of invoices) {
    totals.taxableValue += row.taxableValue;
    totals.taxAmount += row.taxAmount;
    totals.total += row.total;
    totals.refundedAmount += row.refundedAmount;
  }
  json(res, 200, {
    month,
    invoices,
    count: invoices.length,
    totals: {
      taxableValue: round2(totals.taxableValue),
      taxAmount: round2(totals.taxAmount),
      total: round2(totals.total),
      refundedAmount: round2(totals.refundedAmount),
    },
  });
}
