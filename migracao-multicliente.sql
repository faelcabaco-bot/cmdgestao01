-- Executar uma vez em uma instalação MySQL/MariaDB já existente.
-- Todo o conteúdo atual é atribuído à empresa inicial CMD Cosméticos.
CREATE TABLE tenants (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO tenants (id, name)
SELECT '00000000-0000-4000-8000-000000000001',
       COALESCE((SELECT store_name FROM settings WHERE id = 1 LIMIT 1), 'CMD Cosméticos');

ALTER TABLE users ADD tenant_id CHAR(36) NULL;
UPDATE users SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE users MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_users_tenant (tenant_id);

ALTER TABLE profiles ADD tenant_id CHAR(36) NULL;
UPDATE profiles SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE profiles MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_profiles_tenant (tenant_id);

ALTER TABLE user_roles ADD tenant_id CHAR(36) NULL;
UPDATE user_roles SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE user_roles MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_user_roles_tenant (tenant_id);

ALTER TABLE brands ADD tenant_id CHAR(36) NULL;
UPDATE brands SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE brands MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_brands_tenant (tenant_id);

ALTER TABLE categories ADD tenant_id CHAR(36) NULL;
UPDATE categories SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE categories MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_categories_tenant (tenant_id);

ALTER TABLE suppliers ADD tenant_id CHAR(36) NULL;
UPDATE suppliers SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE suppliers MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_suppliers_tenant (tenant_id);

ALTER TABLE customers ADD tenant_id CHAR(36) NULL;
UPDATE customers SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE customers MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_customers_tenant (tenant_id);

ALTER TABLE products ADD tenant_id CHAR(36) NULL;
UPDATE products SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE products MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_products_tenant (tenant_id);

ALTER TABLE stock_batches ADD tenant_id CHAR(36) NULL;
UPDATE stock_batches SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE stock_batches MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_stock_batches_tenant (tenant_id);

ALTER TABLE cash_registers ADD tenant_id CHAR(36) NULL;
UPDATE cash_registers SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE cash_registers MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_cash_registers_tenant (tenant_id);

ALTER TABLE cash_movements ADD tenant_id CHAR(36) NULL;
UPDATE cash_movements SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE cash_movements MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_cash_movements_tenant (tenant_id);

ALTER TABLE sales ADD tenant_id CHAR(36) NULL;
UPDATE sales SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE sales MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_sales_tenant (tenant_id);

ALTER TABLE sale_items ADD tenant_id CHAR(36) NULL;
UPDATE sale_items SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE sale_items MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_sale_items_tenant (tenant_id);

ALTER TABLE sale_payments ADD tenant_id CHAR(36) NULL;
UPDATE sale_payments SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE sale_payments MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_sale_payments_tenant (tenant_id);

ALTER TABLE customer_credit_payments ADD tenant_id CHAR(36) NULL;
UPDATE customer_credit_payments SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE customer_credit_payments MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_credit_tenant (tenant_id);

ALTER TABLE stock_movements ADD tenant_id CHAR(36) NULL;
UPDATE stock_movements SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE stock_movements MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_stock_movements_tenant (tenant_id);

ALTER TABLE settings ADD tenant_id CHAR(36) NULL;
UPDATE settings SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE settings MODIFY tenant_id CHAR(36) NOT NULL, DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id, id);

ALTER TABLE audit_logs ADD tenant_id CHAR(36) NULL;
UPDATE audit_logs SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE audit_logs MODIFY tenant_id CHAR(36) NOT NULL, ADD KEY idx_audit_logs_tenant (tenant_id);

ALTER TABLE cancel_authorization ADD tenant_id CHAR(36) NULL;
UPDATE cancel_authorization SET tenant_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE cancel_authorization MODIFY tenant_id CHAR(36) NOT NULL, DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id, id);
