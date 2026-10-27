-- Phone OTP auth: nullable email/password, phone verification timestamp.
-- Safe to run multiple times.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- Prefer NULL over empty string for unique indexes (multiple phone-only users).
UPDATE users SET email = NULL WHERE email = '';
UPDATE users SET phone = NULL WHERE phone = '';
UPDATE users SET password_hash = NULL WHERE password_hash = '';
