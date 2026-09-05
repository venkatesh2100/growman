// Package services holds cross-cutting helpers used by multiple handlers:
// transactional email (this file, over net/smtp) and OTP issuance/storage
// (otp.go, Redis-backed with an in-memory fallback).
package services

import (
	"fmt"
	"html"
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
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}
	if to == "" {
		return fmt.Errorf("recipient required")
	}

	boundary := "growman-mail-boundary"
	var msg strings.Builder
	msg.WriteString(fmt.Sprintf("From: Growman <%s>\r\n", s.SMTPEmail))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", to))
	msg.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary))

	msg.WriteString("--" + boundary + "\r\n")
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	msg.WriteString(textBody)
	msg.WriteString("\r\n")

	msg.WriteString("--" + boundary + "\r\n")
	msg.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	msg.WriteString(htmlBody)
	msg.WriteString("\r\n")

	msg.WriteString("--" + boundary + "--\r\n")

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

// ValidateEmail validates email format.
func ValidateEmail(email string) bool {
	return strings.Contains(email, "@") && strings.Contains(email, ".")
}
