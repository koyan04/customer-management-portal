-- Create server_keys_audit table to track server key operations

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'server_keys_audit'
  ) THEN
    CREATE TABLE public.server_keys_audit (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      key_id INTEGER,
      action VARCHAR(50) NOT NULL,
      key_username VARCHAR(255),
      key_description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_server_keys_audit_admin 
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
      CONSTRAINT fk_server_keys_audit_server 
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );
    
    CREATE INDEX idx_server_keys_audit_admin_id ON public.server_keys_audit(admin_id);
    CREATE INDEX idx_server_keys_audit_server_id ON public.server_keys_audit(server_id);
    CREATE INDEX idx_server_keys_audit_created_at ON public.server_keys_audit(created_at DESC);
    
    RAISE NOTICE 'server_keys_audit table created';
  ELSE
    RAISE NOTICE 'server_keys_audit table already exists';
  END IF;
END $$;
