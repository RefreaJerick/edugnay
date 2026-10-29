-- Apply after migration 056. Existing choice requests and history are retained.
ALTER TABLE shs_selection_requests
  MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'not_recorded') NOT NULL DEFAULT 'pending';
