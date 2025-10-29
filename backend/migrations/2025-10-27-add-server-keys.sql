-- Add server_keys table to store API/SSH keys for servers
CREATE TABLE IF NOT EXISTS server_keys (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  username TEXT,
  description TEXT,
  original_key TEXT,
  generated_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- optional index for server lookups
CREATE INDEX IF NOT EXISTS server_keys_server_id_idx ON server_keys(server_id);
