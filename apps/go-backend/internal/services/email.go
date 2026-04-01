package services

import (
	"fmt"
	"net/smtp"
	"strings"
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

// SendOTPEmail sends an OTP email to the user
func (s *EmailService) SendOTPEmail(to, otp string) error {
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}

	subject := "Your Growman Verification Code"
	body := fmt.Sprintf(`Your Growman verification code is: %s

Valid for 5 minutes.

If you didn't request this code, please ignore this email.`, otp)

	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s", s.SMTPEmail, to, subject, body)

	auth := smtp.PlainAuth("", s.SMTPEmail, s.SMTPPassword, s.SMTPHost)
	addr := fmt.Sprintf("%s:%s", s.SMTPHost, s.SMTPPort)

	return smtp.SendMail(addr, auth, s.SMTPEmail, []string{to}, []byte(message))
}

// SendAccountCreatedEmail sends account creation confirmation email
func (s *EmailService) SendAccountCreatedEmail(to, name, resetLink string) error {
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}

	subject := "Welcome to Growman - Your Account Has Been Created"
	body := fmt.Sprintf(`Hi %s,

Your account has been created successfully!

You can now log in using your email or phone number.

To set your password, please visit: %s

If you didn't create this account, please contact support.`, name, resetLink)

	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s", s.SMTPEmail, to, subject, body)

	auth := smtp.PlainAuth("", s.SMTPEmail, s.SMTPPassword, s.SMTPHost)
	addr := fmt.Sprintf("%s:%s", s.SMTPHost, s.SMTPPort)

	return smtp.SendMail(addr, auth, s.SMTPEmail, []string{to}, []byte(message))
}

// SendPasswordResetOTP sends a password reset OTP email to the user
func (s *EmailService) SendPasswordResetOTP(to, otp string) error {
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}

	subject := "Password Reset - Growman Verification Code"
	body := fmt.Sprintf(`Hello,

You requested to reset your password for your Growman account.

Your verification code is: %s

This code is valid for 5 minutes.

If you didn't request this password reset, please ignore this email and your password will remain unchanged.

Best regards,
Growman Team`, otp)

	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s", s.SMTPEmail, to, subject, body)

	auth := smtp.PlainAuth("", s.SMTPEmail, s.SMTPPassword, s.SMTPHost)
	addr := fmt.Sprintf("%s:%s", s.SMTPHost, s.SMTPPort)

	return smtp.SendMail(addr, auth, s.SMTPEmail, []string{to}, []byte(message))
}

// SendOrderConfirmationEmail sends order confirmation email to the customer
func (s *EmailService) SendOrderConfirmationEmail(to, name string, orderID uint, amount float64, items []map[string]interface{}) error {
	if s.SMTPEmail == "" || s.SMTPPassword == "" {
		return fmt.Errorf("SMTP credentials not configured")
	}

	subject := fmt.Sprintf("Order Confirmation - Order #%d", orderID)
	
	// Build items list
	itemsList := ""
	for i, item := range items {
		itemName := ""
		itemQty := ""
		itemPrice := ""
		
		if name, ok := item["name"].(string); ok {
			itemName = name
		}
		if qty, ok := item["quantity"].(float64); ok {
			itemQty = fmt.Sprintf("%.0f", qty)
		}
		if price, ok := item["price"].(float64); ok {
			itemPrice = fmt.Sprintf("₹%.2f", price)
		}
		
		itemsList += fmt.Sprintf("%d. %s - Qty: %s - Price: %s\n", i+1, itemName, itemQty, itemPrice)
	}

	body := fmt.Sprintf(`Hi %s,

Thank you for your order! We're excited to confirm your purchase.

Order Details:
Order ID: #%d
Total Amount: ₹%.2f

Items Ordered:
%s

Your order is being processed and will be shipped soon. You will receive another email with tracking information once your order ships.

If you have any questions, please contact our support team.

Thank you for shopping with Growman!

Best regards,
Growman Team`, name, orderID, amount, itemsList)

	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s", s.SMTPEmail, to, subject, body)

	auth := smtp.PlainAuth("", s.SMTPEmail, s.SMTPPassword, s.SMTPHost)
	addr := fmt.Sprintf("%s:%s", s.SMTPHost, s.SMTPPort)

	return smtp.SendMail(addr, auth, s.SMTPEmail, []string{to}, []byte(message))
}

// ValidateEmail validates email format
func ValidateEmail(email string) bool {
	return strings.Contains(email, "@") && strings.Contains(email, ".")
}

