// Customer and staff email: OTP, orders, invoices, back-in-stock, and quotation enquiries.
// Handlers call the method that matches the event. send and sendWithReplyTo deliver through SMTP.
// A missing SMTP user or password throws. The message is built as MIME, not by a template engine.

import nodemailer from "nodemailer";
import { formatRupees, quotationHTML, quotationPDFFilename, quotationText } from "./quotation.js";
import { quotationPDF } from "./quotation_pdf.js";

const siteURL = "https://growman.live";
const bannerURL = `${siteURL}/growman.png`;
const logoURL = `${siteURL}/growman-leaf.png`;
const playStoreURL = "https://play.google.com/store/apps/details?id=com.venky2100.growman";
const supportEmail = "growman.live@gmail.com";

const altBoundary = "growman-mail-boundary";
const mixedBoundary = "growman-mail-mixed";

// host, port, and the mailbox password come from config. An empty password makes every send throw.
export class EmailService {
  constructor(host, port, email, password) {
    this.smtpHost = host || "";
    this.smtpPort = port == null ? "" : String(port);
    this.smtpEmail = email || "";
    this.smtpPassword = password || "";
  }

  // Staff alerts that did not fit in Discord. Plain text only. Returns nothing, or throws when SMTP is not set.
  async sendMerchantAlert(to, subject, body) {
    return this.sendPlain(to, subject, body);
  }

  // Login and signup. The code in the body is the one OTPService just stored. Returns nothing.
  async sendOTPEmail(to, otp) {
    const subject = "Your Growman verification code";
    const text = `Your Growman verification code is ${otp}.\n\nValid for 5 minutes.\n\nIf you didn't request this, ignore this email.\n\nApp: ${playStoreURL}`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Verification code</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Enter this code to verify your email on Growman.</p>
${otpBlock(otp)}`;
    return this.send(to, subject, text, emailShell("Your Growman verification code", inner));
  }

  // Sent when an account is created for the shopper. resetLink is where they set a password.
  async sendAccountCreatedEmail(to, name, resetLink) {
    const subject = "Your Growman account is ready";
    const text = `Hi ${name},\n\nYour Growman account is ready. Sign in with your email or phone.\n\nSet a password: ${resetLink}\n\nGet the app: ${playStoreURL}\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Welcome, ${escapeHTML(name)}</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Your account is set up. You can sign in with your email or phone number.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${escapeHTML(resetLink)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set password</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Didn't create this account? Email us at ${supportEmail}.</p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Shop and scan plants on the <a href="${playStoreURL}" style="color:#059669;text-decoration:none;">Growman app</a>.</p>`;
    return this.send(to, subject, text, emailShell("Your Growman account is ready", inner));
  }

  // Forgot-password code. Tells the reader that ignoring the mail leaves the password unchanged.
  async sendPasswordResetOTP(to, otp) {
    const subject = "Reset your Growman password";
    const text = `Your password reset code is ${otp}.\n\nValid for 5 minutes.\n\nIf you didn't request this, your password stays unchanged.\n\nApp: ${playStoreURL}`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Password reset</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Use this code to choose a new password.</p>
${otpBlock(otp)}`;
    return this.send(to, subject, text, emailShell("Reset your Growman password", inner));
  }

  // Sent after payment succeeds. amount is the rupee total. items are name, quantity, and line price.
  async sendOrderConfirmationEmail(to, name, orderID, amount, items) {
    const subject = `Order #${orderID} confirmed`;
    const safeName = escapeHTML(name);
    let textItems = "";
    let htmlRows = "";
    for (const item of items || []) {
      const itemName = typeof item?.name === "string" ? item.name : "";
      const itemQty = typeof item?.quantity === "number" ? item.quantity : 0;
      const itemPrice = typeof item?.price === "number" ? item.price : 0;
      textItems += `  · ${itemName} × ${fmt0(itemQty)} — ₹${fmt2(itemPrice)}\n`;
      htmlRows += `<tr>
<td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${escapeHTML(itemName)}</td>
<td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;">${fmt0(itemQty)}</td>
<td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#111827;text-align:right;font-weight:500;">₹${fmt2(itemPrice)}</td>
</tr>`;
    }
    const text = `Hi ${name},\n\nOrder #${orderID} is confirmed.\nTotal: ₹${fmt2(amount)}\n\nItems:\n${textItems}\nWe'll notify you when it ships.\n\nTrack orders in the app: ${playStoreURL}\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Order confirmed</h1>
<p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.6;">Hi ${safeName} — we've received your order.</p>
<p style="margin:0 0 24px;font-size:13px;color:#6b7280;">Order <strong style="color:#111827;">#${orderID}</strong></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
<tr style="background:#f9fafb;">
<th align="left" style="padding:8px 0;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
<th align="center" style="padding:8px 8px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
<th align="right" style="padding:8px 0;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount</th>
</tr>
${htmlRows}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="padding-top:12px;font-size:15px;font-weight:600;color:#111827;">Total</td>
<td style="padding-top:12px;font-size:15px;font-weight:600;color:#047857;text-align:right;">₹${fmt2(amount)}</td>
</tr></table>
<p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">We'll send tracking details once your order ships. Track your order anytime in the <a href="${playStoreURL}" style="color:#059669;text-decoration:none;">Growman app</a>.</p>`;
    return this.send(to, subject, text, emailShell(`Order #${orderID} confirmed — ₹${fmt2(amount)}`, inner));
  }

  // Sent to everyone who asked to be told when this product is available again.
  async sendBackInStockEmail(to, productName, productSlug) {
    const subject = `${productName} is back in stock`;
    const link = `${siteURL}/product/${productSlug}`;
    const text = `Good news — ${productName} is back in stock.\n\nShop it here: ${link}\n\nStock is limited and we email everyone on the list at once, so it may not last long.\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Back in stock</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;"><strong style="color:#111827;">${escapeHTML(productName)}</strong> is available again.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${escapeHTML(link)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Shop now</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">We notify everyone on the waiting list at the same time, so stock may go quickly.</p>`;
    return this.send(to, subject, text, emailShell(subject, inner));
  }

  // Sent when an order is cancelled. refunded true means the refund was started for the paid amount.
  async sendOrderCancelledEmail(to, name, orderID, amount, refunded) {
    const subject = `Order #${orderID} cancelled`;
    let refundText = "If you were charged, our team will process your refund shortly.";
    // A started refund names the amount and the usual bank delay. Otherwise we only say staff will handle it.
    if (refunded) {
      refundText = `We've started a refund of ₹${fmt2(amount)} to your original payment method. Banks usually take 5-7 working days to show it.`;
    }
    const text = `Hi ${name},\n\nOrder #${orderID} has been cancelled.\n\n${refundText}\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Order cancelled</h1>
<p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHTML(name)} — order <strong style="color:#111827;">#${orderID}</strong> has been cancelled.</p>
<p style="margin:16px 0 0;font-size:14px;color:#374151;line-height:1.6;">${escapeHTML(refundText)}</p>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Changed your mind? Browse again at <a href="${siteURL}" style="color:#059669;text-decoration:none;">growman.live</a>.</p>`;
    return this.send(to, subject, text, emailShell(subject, inner));
  }

  // Sent when the courier has an airway bill. A missing tracking URL falls back to the orders page.
  async sendOrderShippedEmail(to, name, orderID, courier, awb, trackingURL) {
    const subject = `Order #${orderID} is on its way`;
    let link = trackingURL;
    // No courier link yet. The orders page is still a place to look.
    if (!link) link = `${siteURL}/orders`;
    const text = `Hi ${name},\n\nOrder #${orderID} has shipped via ${courier}.\nTracking number: ${awb}\nTrack it: ${link}\n\nPlants travel best when unboxed soon after arrival — do open the parcel the day it lands.\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">On its way</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHTML(name)} — order <strong style="color:#111827;">#${orderID}</strong> has shipped.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;margin-bottom:20px;">
<tr><td style="padding:14px 16px;font-size:13px;color:#6b7280;">Courier</td><td style="padding:14px 16px;font-size:14px;color:#111827;text-align:right;font-weight:500;">${escapeHTML(courier)}</td></tr>
<tr><td style="padding:0 16px 14px;font-size:13px;color:#6b7280;">Tracking number</td><td style="padding:0 16px 14px;font-size:14px;color:#111827;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHTML(awb)}</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${escapeHTML(link)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Track shipment</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Plants travel best when unboxed soon after they arrive — please open the parcel on delivery day and give them a drink.</p>`;
    return this.send(to, subject, text, emailShell(subject, inner));
  }

  // Sent a while after delivery, asking for a review of one product from the order.
  async sendReviewRequestEmail(to, name, orderID, productName, productSlug) {
    const subject = `How is your ${productName} doing?`;
    const link = `${siteURL}/product/${productSlug}#reviews`;
    const text = `Hi ${name},\n\nYour ${productName} arrived a little while ago — how is it settling in?\n\nA short review (and a photo, if you have one) helps other gardeners know what to expect: ${link}\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">How is it settling in?</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHTML(name)} — your <strong style="color:#111827;">${escapeHTML(productName)}</strong> from order #${orderID} arrived a little while ago.</p>
<p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">A short review helps other gardeners know what to expect. A photo of how it's doing helps even more.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${escapeHTML(link)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Write a review</a>
</td></tr></table>`;
    return this.send(to, subject, text, emailShell(subject, inner));
  }

  // Sent when a saved cart has been sitting. items are display strings. A missing cart URL uses /cart.
  async sendAbandonedCartEmail(to, name, items, cartURL) {
    const subject = "You left something in your cart";
    let link = cartURL;
    if (!link) link = `${siteURL}/cart`;
    let textItems = "";
    let htmlItems = "";
    for (const item of items || []) {
      textItems += `  · ${item}\n`;
      htmlItems += `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${escapeHTML(item)}</td></tr>`;
    }
    const text = `Hi ${name},\n\nYour cart is still waiting:\n${textItems}\nPick up where you left off: ${link}\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Still interested?</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHTML(name)} — these are still in your cart.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${htmlItems}</table>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${escapeHTML(link)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Return to cart</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Stock is limited on many plants, so we can't hold items indefinitely.</p>`;
    return this.send(to, subject, text, emailShell(subject, inner));
  }

  // Tax invoice PDF attached to the order email. pdf is the file bytes.
  async sendInvoiceEmail(to, name, orderID, invoiceNumber, pdf) {
    const subject = `Tax invoice ${invoiceNumber} for order #${orderID}`;
    const text = `Hi ${name},\n\nYour tax invoice ${invoiceNumber} for order #${orderID} is attached.\n\n— Growman`;
    const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Your tax invoice</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHTML(name)} — invoice <strong style="color:#111827;">${escapeHTML(invoiceNumber)}</strong> for order #${orderID} is attached as a PDF.</p>
<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">Keep it for your records. If you need it reissued with GSTIN details, reply to this email.</p>`;
    return this.sendWithReplyTo(to, "", subject, text, emailShell(subject, inner), [
      { filename: `invoice-${invoiceNumber}.pdf`, contentType: "application/pdf", data: pdf },
    ]);
  }

  // Staff mail for a bulk quotation. The PDF is attached when it renders. A render failure still sends the mail.
  async sendQuotationEnquiry(to, quotation, meta) {
    const subject = `Quotation enquiry ${quotation.estimateNo} — ${quotation.requester?.name ?? ""} (${(quotation.lines || []).length} items, ${formatRupees(quotation.total)})`;
    const attachments = [];
    try {
      const pdf = await quotationPDF(quotation);
      attachments.push({
        filename: quotationPDFFilename(quotation),
        contentType: "application/pdf",
        data: pdf,
      });
    } catch (err) {
      // Staff still need the enquiry if the PDF library fails. The body has the same numbers.
      console.log(`[QUOTATION] pdf render failed for ${quotation.estimateNo}: ${err?.message || err}`);
    }
    return this.sendWithReplyTo(
      to,
      quotation.requester?.email || "",
      subject,
      quotationText(quotation, meta),
      quotationHTML(quotation, meta),
      attachments,
    );
  }

  // HTML plus plain text, with no special reply address.
  async send(to, subject, textBody, htmlBody) {
    return this.sendWithReplyTo(to, "", subject, textBody, htmlBody);
  }

  // The send used by quotations, so a reply goes to the shopper. attachments may be empty.
  // Throws when SMTP is not configured or the recipient is blank.
  async sendWithReplyTo(to, replyTo, subject, textBody, htmlBody, attachments = []) {
    // Do not open a socket with an empty login. The caller sees a clear error instead of an auth failure.
    if (!this.smtpEmail || !this.smtpPassword) throw new Error("SMTP credentials not configured");
    if (!to) throw new Error("recipient required");
    const raw = buildMime({
      from: this.smtpEmail,
      to,
      replyTo,
      subject,
      textBody,
      htmlBody,
      attachments,
    });
    return this.deliver(to, raw);
  }

  // One-part plain text, used by staff alerts. Same credential check as the HTML send.
  async sendPlain(to, subject, body) {
    if (!this.smtpEmail || !this.smtpPassword) throw new Error("SMTP credentials not configured");
    if (!to) throw new Error("recipient required");
    const raw = `From: Growman <${this.smtpEmail}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
    return this.deliver(to, raw);
  }

  // Hands the raw MIME to SMTP. Port 465 uses implicit TLS. Any other port starts plain and may upgrade.
  // The connection is closed even when the send throws.
  async deliver(to, raw) {
    const port = Number(this.smtpPort) || 0;
    const tx = nodemailer.createTransport({
      host: this.smtpHost,
      port,
      // 465 is implicit TLS. Other ports, including 587, start without it.
      secure: port === 465,
      auth: { user: this.smtpEmail, pass: this.smtpPassword },
    });
    try {
      await tx.sendMail({
        envelope: { from: this.smtpEmail, to },
        raw: Buffer.from(raw, "utf8"),
      });
    } finally {
      tx.close();
    }
  }
}

// Startup helper. Returns an EmailService. It does not connect until the first send.
export function newEmailService(host, port, email, password) {
  return new EmailService(host, port, email, password);
}

// A light check used before we try to send. True when the string contains @ and a dot.
export function validateEmail(email) {
  return String(email ?? "").includes("@") && String(email ?? "").includes(".");
}

// Strip CR/LF so a name or subject cannot inject extra headers.
function stripHeaderBreaks(v) {
  return String(v ?? "").replace(/[\r\n]/g, "");
}

// Builds the MIME message. HTML and plain text are alternatives. Files, when present, wrap that pair.
function buildMime({ from, to, replyTo, subject, textBody, htmlBody, attachments }) {
  let msg = "";
  msg += `From: Growman <${from}>\r\n`;
  msg += `To: ${stripHeaderBreaks(to)}\r\n`;
  const reply = stripHeaderBreaks(String(replyTo ?? "").trim());
  if (reply) msg += `Reply-To: ${reply}\r\n`;
  msg += `Subject: ${qEncode("utf-8", stripHeaderBreaks(subject))}\r\n`;
  msg += "MIME-Version: 1.0\r\n";
  // Files wrap the text and HTML parts. Without files, the message is just the two alternatives.
  if (attachments.length) {
    msg += `Content-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n`;
    msg += `--${mixedBoundary}\r\n`;
  }
  msg += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;
  msg += `--${altBoundary}\r\n`;
  msg += "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
  msg += textBody;
  msg += "\r\n";
  msg += `--${altBoundary}\r\n`;
  msg += "Content-Type: text/html; charset=UTF-8\r\n\r\n";
  msg += htmlBody;
  msg += "\r\n";
  msg += `--${altBoundary}--\r\n`;
  for (const a of attachments) {
    const name = stripHeaderBreaks(String(a.filename ?? "").replaceAll('"', ""));
    const contentType = stripHeaderBreaks(a.contentType || "application/octet-stream");
    msg += `--${mixedBoundary}\r\n`;
    msg += `Content-Type: ${contentType}; name="${name}"\r\n`;
    msg += `Content-Disposition: attachment; filename="${name}"\r\n`;
    msg += "Content-Transfer-Encoding: base64\r\n\r\n";
    msg += wrapBase64(a.data);
  }
  if (attachments.length) msg += `--${mixedBoundary}--\r\n`;
  return msg;
}

// Base64 with a line break every 76 characters, which is what MIME readers expect.
function wrapBase64(data) {
  let encoded = Buffer.from(data || []).toString("base64");
  let out = "";
  while (encoded.length > 76) {
    out += encoded.slice(0, 76) + "\r\n";
    encoded = encoded.slice(76);
  }
  return out + encoded + "\r\n";
}

// Encodes a subject that is not plain ASCII, split so each encoded word stays within 75 characters.
function qEncode(charset, s) {
  if (!needsEncoding(s)) return s;
  let out = `=?${charset}?q?`;
  if (!isUTF8(charset)) {
    out += writeQBytes(Buffer.from(s, "utf8"));
    return out + "?=";
  }
  const bytes = Buffer.from(s, "utf8");
  const maxContentLen = 75 - "=?UTF-8?q?".length - "?=".length;
  let currentLen = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let runeLen;
    let encLen;
    if (b >= 0x20 && b <= 0x7e && b !== 0x3d && b !== 0x3f && b !== 0x5f) {
      runeLen = 1;
      encLen = 1;
    } else {
      runeLen = utf8RuneLen(bytes, i);
      encLen = 3 * runeLen;
    }
    // Start a new encoded word before this character would pass the 75-character header limit.
    if (currentLen + encLen > maxContentLen) {
      out += `?= =?${charset}?q?`;
      currentLen = 0;
    }
    out += writeQBytes(bytes.subarray(i, i + runeLen));
    currentLen += encLen;
    i += runeLen;
  }
  return out + "?=";
}

// True when the subject has a character a plain header cannot carry. Tab is allowed.
function needsEncoding(s) {
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    if ((c < 32 || c > 126) && c !== 9) return true;
  }
  return false;
}

// True when the charset name is UTF-8, which is the only charset the subject encoder splits by character.
function isUTF8(charset) {
  return String(charset).toLowerCase() === "utf-8";
}

// How many bytes this UTF-8 character occupies, capped by the bytes that are left.
function utf8RuneLen(bytes, i) {
  const b = bytes[i];
  if (b < 0x80) return 1;
  if ((b & 0xe0) === 0xc0) return Math.min(2, bytes.length - i);
  if ((b & 0xf0) === 0xe0) return Math.min(3, bytes.length - i);
  if ((b & 0xf8) === 0xf0) return Math.min(4, bytes.length - i);
  return 1;
}

// Quoted-printable bytes. Space becomes underscore. Safe ASCII stays as itself.
function writeQBytes(bytes) {
  let out = "";
  for (const b of bytes) {
    if (b === 0x20) out += "_";
    else if (b >= 0x21 && b <= 0x7e && b !== 0x3d && b !== 0x3f && b !== 0x5f) out += String.fromCharCode(b);
    else out += `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// The shared HTML frame: banner, the message, and the footer with the support address.
function emailShell(preheader, innerHTML) {
  const hidden = escapeHTML(preheader);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Growman</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${hidden}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:0;line-height:0;">
<a href="${siteURL}" style="text-decoration:none;">
<img src="${bannerURL}" alt="Growman" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</a>
</td></tr>
<tr><td style="padding:32px 28px 8px;">
${innerHTML}
</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:middle;">
<img src="${logoURL}" alt="" width="28" height="28" style="display:inline-block;vertical-align:middle;border:0;">
<span style="font-size:13px;color:#6b7280;vertical-align:middle;margin-left:8px;">Growman · <a href="${siteURL}" style="color:#059669;text-decoration:none;">growman.live</a></span>
</td>
</tr>
<tr><td style="padding-top:8px;font-size:12px;color:#9ca3af;line-height:1.5;">
Questions? <a href="mailto:${supportEmail}" style="color:#059669;text-decoration:none;">${supportEmail}</a>
</td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#9ca3af;line-height:1.5;">
<a href="${playStoreURL}" style="color:#059669;text-decoration:none;font-weight:500;">Get the Growman app on Google Play</a>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// The green code block used by both verification and password-reset mails.
function otpBlock(code) {
  return `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">Use this code to continue:</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 28px;text-align:center;">
<span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#047857;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${escapeHTML(code)}</span>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`;
}

// Escapes text that came from a shopper or a product name before it is placed in HTML.
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}

// A quantity with no decimal places.
function fmt0(n) {
  return (Math.round(Number(n) || 0)).toFixed(0);
}

// A rupee amount with two decimals. A non-number prints as 0.00.
function fmt2(n) {
  return (Number(n) || 0).toFixed(2);
}
