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

// ValidateEmail validates email format
func ValidateEmail(email string) bool {
	return strings.Contains(email, "@") && strings.Contains(email, ".")
}

