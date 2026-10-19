-- Atualizacao para o caderno de fiado (banco MySQL/MariaDB existente).
CREATE TABLE IF NOT EXISTS customer_credit_payments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  sale_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  register_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(20) NOT NULL,
  notes VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_credit_sale (sale_id),
  KEY idx_credit_customer (customer_id, created_at),
  KEY idx_credit_register (register_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
