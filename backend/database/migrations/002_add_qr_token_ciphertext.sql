-- Apply once to databases created before encrypted QR credential storage was added.
ALTER TABLE student_qr_credentials
  ADD COLUMN token_ciphertext TEXT NULL AFTER token_hash;
