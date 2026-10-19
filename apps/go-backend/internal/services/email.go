// Package services holds cross-cutting helpers used by multiple handlers:
// transactional email (this file, over net/smtp) and OTP issuance/storage
// (otp.go, Redis-backed with an in-memory fallback).
package services

import (
	"encoding/base64"
	"fmt"
	"html"
	"mime"
	"net/smtp"
	"strings"
)

const (
	siteURL      = "https://growman.live"
	bannerURL    = siteURL + "/growman.png"
	logoURL      = siteURL + "/growman-leaf.png"
	playStoreURL = "https://play.google.com/store/apps/details?id=com.venky2100.growman"
	supportEmail = "growman.live@gmail.com"
)

type EmailService struct {
	SMTPHost     string
	SMTPPort     string
	SMTPEmail    string
	SMTPPassword string
}

func NewEmailService(host, port, email, password string) *EmailService {
	return &EmailService{
		SMTPHost:     host,
		SMTPPort:     port,
		SMTPEmail:    email,
		SMTPPassword: password,
	}
}

func (s *EmailService) send(to, subject, textBody, htmlBody string) error {
	return s.sendWithReplyTo(to, "", subject, textBody, htmlBody)
}

func stripHeaderBreaks(v string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(v)
}

// Attachment is a file sent alongside an email body.
type Attachment struct {
	Filename    string
	ContentType string
	Data        []byte
}

func (s *EmailService) sendWithReplyTo(to, replyTo, subject, textBody, htmlBody string, attachments ...Attachment) error {
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}
	if to == "" {
		return fmt.Errorf("recipient required")
	}

	const altBoundary = "growman-mail-boundary"
	const mixedBoundary = "growman-mail-mixed"
	var msg strings.Builder
	msg.WriteString(fmt.Sprintf("From: Growman <%s>\r\n", s.SMTPEmail))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", stripHeaderBreaks(to)))
	if replyTo = stripHeaderBreaks(strings.TrimSpace(replyTo)); replyTo != "" {
		msg.WriteString(fmt.Sprintf("Reply-To: %s\r\n", replyTo))
	}
	msg.WriteString(fmt.Sprintf("Subject: %s\r\n", mime.QEncoding.Encode("utf-8", stripHeaderBreaks(subject))))
	msg.WriteString("MIME-Version: 1.0\r\n")
	if len(attachments) > 0 {
		msg.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=%q\r\n\r\n", mixedBoundary))
		msg.WriteString("--" + mixedBoundary + "\r\n")
	}
	msg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q\r\n\r\n", altBoundary))

	msg.WriteString("--" + altBoundary + "\r\n")
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	msg.WriteString(textBody)
	msg.WriteString("\r\n")

	msg.WriteString("--" + altBoundary + "\r\n")
	msg.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	msg.WriteString(htmlBody)
	msg.WriteString("\r\n")

	msg.WriteString("--" + altBoundary + "--\r\n")

	for _, a := range attachments {
		name := stripHeaderBreaks(strings.ReplaceAll(a.Filename, `"`, ""))
		msg.WriteString("--" + mixedBoundary + "\r\n")
		msg.WriteString(fmt.Sprintf("Content-Type: %s; name=%q\r\n", stripHeaderBreaks(a.ContentType), name))
		msg.WriteString(fmt.Sprintf("Content-Disposition: attachment; filename=%q\r\n", name))
		msg.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		encoded := base64.StdEncoding.EncodeToString(a.Data)
		for len(encoded) > 76 {
			msg.WriteString(encoded[:76] + "\r\n")
			encoded = encoded[76:]
		}
		msg.WriteString(encoded + "\r\n")
	}
	if len(attachments) > 0 {
		msg.WriteString("--" + mixedBoundary + "--\r\n")
	}

	auth := smtp.PlainAuth("", s.SMTPEmail, s.SMTPPassword, s.SMTPHost)
	addr := fmt.Sprintf("%s:%s", s.SMTPHost, s.SMTPPort)
	return smtp.SendMail(addr, auth, s.SMTPEmail, []string{to}, []byte(msg.String()))
}

func (s *EmailService) sendPlain(to, subject, body string) error {
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}
	if to == "" {
		return fmt.Errorf("recipient required")
	}
	message := fmt.Sprintf("From: Growman <%s>\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		s.SMTPEmail, to, subject, body)
	auth := smtp.PlainAuth("", s.SMTPEmail, s.SMTPPassword, s.SMTPHost)
	addr := fmt.Sprintf("%s:%s", s.SMTPHost, s.SMTPPort)
	return smtp.SendMail(addr, auth, s.SMTPEmail, []string{to}, []byte(message))
}

func emailShell(preheader, innerHTML string) string {
	preheader = html.EscapeString(preheader)
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Growman</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">%s</span>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:0;line-height:0;">
<a href="%s" style="text-decoration:none;">
<img src="%s" alt="Growman" width="600" style="display:block;width:100%%;max-width:600px;height:auto;border:0;">
</a>
</td></tr>
<tr><td style="padding:32px 28px 8px;">
%s
</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #f3f4f6;">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:middle;">
<img src="%s" alt="" width="28" height="28" style="display:inline-block;vertical-align:middle;border:0;">
<span style="font-size:13px;color:#6b7280;vertical-align:middle;margin-left:8px;">Growman · <a href="%s" style="color:#059669;text-decoration:none;">growman.live</a></span>
</td>
</tr>
<tr><td style="padding-top:8px;font-size:12px;color:#9ca3af;line-height:1.5;">
Questions? <a href="mailto:%s" style="color:#059669;text-decoration:none;">%s</a>
</td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#9ca3af;line-height:1.5;">
<a href="%s" style="color:#059669;text-decoration:none;font-weight:500;">Get the Growman app on Google Play</a>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`, preheader, siteURL, bannerURL, innerHTML, logoURL, siteURL, supportEmail, supportEmail, playStoreURL)
}

func otpBlock(code string) string {
	return fmt.Sprintf(`<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">Use this code to continue:</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 28px;text-align:center;">
<span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#047857;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">%s</span>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`,
		html.EscapeString(code))
}

// SendMerchantAlert emails the merchant inbox (internal ops alerts).
func (s *EmailService) SendMerchantAlert(to, subject, body string) error {
	return s.sendPlain(to, subject, body)
}

// SendOTPEmail sends an OTP email to the user.
func (s *EmailService) SendOTPEmail(to, otp string) error {
	subject := "Your Growman verification code"
	text := fmt.Sprintf("Your Growman verification code is %s.\n\nValid for 5 minutes.\n\nIf you didn't request this, ignore this email.\n\nApp: %s", otp, playStoreURL)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Verification code</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Enter this code to verify your email on Growman.</p>
%s`, otpBlock(otp))
	htmlBody := emailShell("Your Growman verification code", inner)
	return s.send(to, subject, text, htmlBody)
}

// SendAccountCreatedEmail sends account creation confirmation email.
func (s *EmailService) SendAccountCreatedEmail(to, name, resetLink string) error {
	subject := "Your Growman account is ready"
	safeName := html.EscapeString(name)
	safeLink := html.EscapeString(resetLink)
	text := fmt.Sprintf("Hi %s,\n\nYour Growman account is ready. Sign in with your email or phone.\n\nSet a password: %s\n\nGet the app: %s\n\n— Growman", name, resetLink, playStoreURL)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Welcome, %s</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Your account is set up. You can sign in with your email or phone number.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="%s" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set password</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Didn't create this account? Email us at %s.</p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Shop and scan plants on the <a href="%s" style="color:#059669;text-decoration:none;">Growman app</a>.</p>`,
		safeName, safeLink, supportEmail, playStoreURL)
	htmlBody := emailShell("Your Growman account is ready", inner)
	return s.send(to, subject, text, htmlBody)
}

// SendPasswordResetOTP sends a password reset OTP email to the user.
func (s *EmailService) SendPasswordResetOTP(to, otp string) error {
	subject := "Reset your Growman password"
	text := fmt.Sprintf("Your password reset code is %s.\n\nValid for 5 minutes.\n\nIf you didn't request this, your password stays unchanged.\n\nApp: %s", otp, playStoreURL)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Password reset</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Use this code to choose a new password.</p>
%s`, otpBlock(otp))
	htmlBody := emailShell("Reset your Growman password", inner)
	return s.send(to, subject, text, htmlBody)
}

// SendOrderConfirmationEmail sends order confirmation email to the customer.
func (s *EmailService) SendOrderConfirmationEmail(to, name string, orderID uint, amount float64, items []map[string]any) error {
	subject := fmt.Sprintf("Order #%d confirmed", orderID)
	safeName := html.EscapeString(name)

	var textItems strings.Builder
	var htmlRows strings.Builder
	for _, item := range items {
		itemName := ""
		itemQty := 0.0
		itemPrice := 0.0
		if n, ok := item["name"].(string); ok {
			itemName = n
		}
		if qty, ok := item["quantity"].(float64); ok {
			itemQty = qty
		}
		if price, ok := item["price"].(float64); ok {
			itemPrice = price
		}
		textItems.WriteString(fmt.Sprintf("  · %s × %.0f — ₹%.2f\n", itemName, itemQty, itemPrice))
		htmlRows.WriteString(fmt.Sprintf(`<tr>
<td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">%s</td>
<td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;">%.0f</td>
<td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#111827;text-align:right;font-weight:500;">₹%.2f</td>
</tr>`, html.EscapeString(itemName), itemQty, itemPrice))
	}

	text := fmt.Sprintf("Hi %s,\n\nOrder #%d is confirmed.\nTotal: ₹%.2f\n\nItems:\n%s\nWe'll notify you when it ships.\n\nTrack orders in the app: %s\n\n— Growman", name, orderID, amount, textItems.String(), playStoreURL)

	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Order confirmed</h1>
<p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.6;">Hi %s — we've received your order.</p>
<p style="margin:0 0 24px;font-size:13px;color:#6b7280;">Order <strong style="color:#111827;">#%d</strong></p>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
<tr style="background:#f9fafb;">
<th align="left" style="padding:8px 0;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
<th align="center" style="padding:8px 8px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
<th align="right" style="padding:8px 0;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount</th>
</tr>
%s
</table>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr>
<td style="padding-top:12px;font-size:15px;font-weight:600;color:#111827;">Total</td>
<td style="padding-top:12px;font-size:15px;font-weight:600;color:#047857;text-align:right;">₹%.2f</td>
</tr></table>
<p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">We'll send tracking details once your order ships. Track your order anytime in the <a href="%s" style="color:#059669;text-decoration:none;">Growman app</a>.</p>`,
		safeName, orderID, htmlRows.String(), amount, playStoreURL)

	htmlBody := emailShell(fmt.Sprintf("Order #%d confirmed — ₹%.2f", orderID, amount), inner)
	return s.send(to, subject, text, htmlBody)
}

// SendBackInStockEmail tells a waiting customer an item is available
// again. For a nursery this is a high-intent message: availability is
// seasonal and the recipient asked to be told.
func (s *EmailService) SendBackInStockEmail(to, productName, productSlug string) error {
	subject := fmt.Sprintf("%s is back in stock", productName)
	safeName := html.EscapeString(productName)
	link := siteURL + "/product/" + productSlug

	text := fmt.Sprintf("Good news — %s is back in stock.\n\nShop it here: %s\n\nStock is limited and we email everyone on the list at once, so it may not last long.\n\n— Growman", productName, link)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Back in stock</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;"><strong style="color:#111827;">%s</strong> is available again.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="%s" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Shop now</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">We notify everyone on the waiting list at the same time, so stock may go quickly.</p>`,
		safeName, html.EscapeString(link))
	return s.send(to, subject, text, emailShell(subject, inner))
}

// SendOrderCancelledEmail confirms a cancellation and sets the refund
// expectation, which is the question this email otherwise generates.
func (s *EmailService) SendOrderCancelledEmail(to, name string, orderID uint, amount float64, refunded bool) error {
	subject := fmt.Sprintf("Order #%d cancelled", orderID)
	safeName := html.EscapeString(name)

	refundText := "If you were charged, our team will process your refund shortly."
	if refunded {
		refundText = fmt.Sprintf("We've started a refund of ₹%.2f to your original payment method. Banks usually take 5-7 working days to show it.", amount)
	}

	text := fmt.Sprintf("Hi %s,\n\nOrder #%d has been cancelled.\n\n%s\n\n— Growman", name, orderID, refundText)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Order cancelled</h1>
<p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.6;">Hi %s — order <strong style="color:#111827;">#%d</strong> has been cancelled.</p>
<p style="margin:16px 0 0;font-size:14px;color:#374151;line-height:1.6;">%s</p>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Changed your mind? Browse again at <a href="%s" style="color:#059669;text-decoration:none;">growman.live</a>.</p>`,
		safeName, orderID, html.EscapeString(refundText), siteURL)
	return s.send(to, subject, text, emailShell(subject, inner))
}

// SendOrderShippedEmail delivers tracking details. Not sending this is the
// single largest driver of "where is my order" support contacts.
func (s *EmailService) SendOrderShippedEmail(to, name string, orderID uint, courier, awb, trackingURL string) error {
	subject := fmt.Sprintf("Order #%d is on its way", orderID)
	safeName := html.EscapeString(name)
	if trackingURL == "" {
		trackingURL = siteURL + "/orders"
	}

	text := fmt.Sprintf("Hi %s,\n\nOrder #%d has shipped via %s.\nTracking number: %s\nTrack it: %s\n\nPlants travel best when unboxed soon after arrival — do open the parcel the day it lands.\n\n— Growman",
		name, orderID, courier, awb, trackingURL)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">On its way</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi %s — order <strong style="color:#111827;">#%d</strong> has shipped.</p>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;margin-bottom:20px;">
<tr><td style="padding:14px 16px;font-size:13px;color:#6b7280;">Courier</td><td style="padding:14px 16px;font-size:14px;color:#111827;text-align:right;font-weight:500;">%s</td></tr>
<tr><td style="padding:0 16px 14px;font-size:13px;color:#6b7280;">Tracking number</td><td style="padding:0 16px 14px;font-size:14px;color:#111827;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">%s</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="%s" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Track shipment</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Plants travel best when unboxed soon after they arrive — please open the parcel on delivery day and give them a drink.</p>`,
		safeName, orderID, html.EscapeString(courier), html.EscapeString(awb), html.EscapeString(trackingURL))
	return s.send(to, subject, text, emailShell(subject, inner))
}

// SendReviewRequestEmail asks for a review a while after delivery, once
// the customer has actually lived with the plant.
func (s *EmailService) SendReviewRequestEmail(to, name string, orderID uint, productName, productSlug string) error {
	subject := "How is your " + productName + " doing?"
	safeName := html.EscapeString(name)
	link := siteURL + "/product/" + productSlug + "#reviews"

	text := fmt.Sprintf("Hi %s,\n\nYour %s arrived a little while ago — how is it settling in?\n\nA short review (and a photo, if you have one) helps other gardeners know what to expect: %s\n\n— Growman", name, productName, link)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">How is it settling in?</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi %s — your <strong style="color:#111827;">%s</strong> from order #%d arrived a little while ago.</p>
<p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">A short review helps other gardeners know what to expect. A photo of how it's doing helps even more.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="%s" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Write a review</a>
</td></tr></table>`,
		safeName, html.EscapeString(productName), orderID, html.EscapeString(link))
	return s.send(to, subject, text, emailShell(subject, inner))
}

// SendAbandonedCartEmail nudges a customer who left items behind.
func (s *EmailService) SendAbandonedCartEmail(to, name string, items []string, cartURL string) error {
	subject := "You left something in your cart"
	safeName := html.EscapeString(name)
	if cartURL == "" {
		cartURL = siteURL + "/cart"
	}

	var textItems strings.Builder
	var htmlItems strings.Builder
	for _, item := range items {
		textItems.WriteString("  · " + item + "\n")
		htmlItems.WriteString(fmt.Sprintf(`<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">%s</td></tr>`, html.EscapeString(item)))
	}

	text := fmt.Sprintf("Hi %s,\n\nYour cart is still waiting:\n%s\nPick up where you left off: %s\n\n— Growman", name, textItems.String(), cartURL)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Still interested?</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi %s — these are still in your cart.</p>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">%s</table>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="%s" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Return to cart</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Stock is limited on many plants, so we can't hold items indefinitely.</p>`,
		safeName, htmlItems.String(), html.EscapeString(cartURL))
	return s.send(to, subject, text, emailShell(subject, inner))
}

// SendInvoiceEmail delivers the GST tax invoice as a PDF attachment.
func (s *EmailService) SendInvoiceEmail(to, name string, orderID uint, invoiceNumber string, pdf []byte) error {
	subject := fmt.Sprintf("Tax invoice %s for order #%d", invoiceNumber, orderID)
	safeName := html.EscapeString(name)

	text := fmt.Sprintf("Hi %s,\n\nYour tax invoice %s for order #%d is attached.\n\n— Growman", name, invoiceNumber, orderID)
	inner := fmt.Sprintf(`<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Your tax invoice</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi %s — invoice <strong style="color:#111827;">%s</strong> for order #%d is attached as a PDF.</p>
<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">Keep it for your records. If you need it reissued with GSTIN details, reply to this email.</p>`,
		safeName, html.EscapeString(invoiceNumber), orderID)

	attachment := Attachment{
		Filename:    fmt.Sprintf("invoice-%s.pdf", invoiceNumber),
		ContentType: "application/pdf",
		Data:        pdf,
	}
	return s.sendWithReplyTo(to, "", subject, text, emailShell(subject, inner), attachment)
}

// ValidateEmail validates email format.
func ValidateEmail(email string) bool {
	return strings.Contains(email, "@") && strings.Contains(email, ".")
}
