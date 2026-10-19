CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'CMD Cosméticos')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'profiles', 'user_roles', 'brands', 'categories', 'suppliers', 'customers',
    'products', 'stock_batches', 'cash_registers', 'cash_movements', 'sales', 'sale_items',
    'sale_payments', 'customer_credit_payments', 'stock_movements', 'settings', 'audit_logs',
    'cancel_authorization'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id TEXT', table_name);
    EXECUTE format(
      'UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL',
      table_name, '00000000-0000-4000-8000-000000000001'
    );
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', 'idx_' || table_name || '_tenant', table_name);
  END LOOP;
END $$;

DO $$
DECLARE
  constraint_name TEXT;
  primary_columns TEXT[];
BEGIN
  SELECT c.conname, array_agg(a.attname ORDER BY k.ordinality)
    INTO constraint_name, primary_columns
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'settings'::regclass AND c.contype = 'p'
  GROUP BY c.conname;
  IF primary_columns = ARRAY['id'] THEN
    EXECUTE format('ALTER TABLE settings DROP CONSTRAINT %I', constraint_name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='settings'::regclass AND contype='p') THEN
    ALTER TABLE settings ADD PRIMARY KEY (tenant_id, id);
  END IF;

  SELECT c.conname, array_agg(a.attname ORDER BY k.ordinality)
    INTO constraint_name, primary_columns
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'cancel_authorization'::regclass AND c.contype = 'p'
  GROUP BY c.conname;
  IF primary_columns = ARRAY['id'] THEN
    EXECUTE format('ALTER TABLE cancel_authorization DROP CONSTRAINT %I', constraint_name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='cancel_authorization'::regclass AND contype='p') THEN
    ALTER TABLE cancel_authorization ADD PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

INSERT INTO settings (tenant_id, id, store_name, receipt_footer)
VALUES ('00000000-0000-4000-8000-000000000001', 1, 'CMD Cosméticos', 'Obrigado pela preferência!')
ON CONFLICT (tenant_id, id) DO NOTHING;
