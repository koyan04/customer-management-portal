#!/bin/bash
# Fix the restore duplicate key issue on remote server

TARGET_FILE="/srv/cmp/backend/routes/admin.js"

# Backup original
cp "$TARGET_FILE" "$TARGET_FILE.bak.$(date +%s)"

# Apply the fix using sed
# Replace the simple users insert with the conflict-handling version
sed -i '/\/\/ users: upsert by id (all fields)/,/^    }$/c\
    // users: upsert by id (all fields) - handle both id and (server_id, account_name) conflicts\
    if (Array.isArray(data.users)) {\
      for (const u of data.users) {\
        if (!u.id) continue;\
        // First try to find existing user by server_id + account_name\
        const existing = await client.query(\
          '\''SELECT id FROM users WHERE server_id = $1 AND account_name = $2'\'',\
          [u.server_id, u.account_name]\
        );\
        const existingId = existing.rows && existing.rows[0] ? existing.rows[0].id : null;\
        \
        if (existingId && existingId !== u.id) {\
          // User exists with different ID - update the existing one instead\
          await client.query(\
            `UPDATE users SET service_type = $1, contact = $2, expire_date = $3, total_devices = $4, data_limit_gb = $5, remark = $6, display_pos = $7\
             WHERE id = $8`,\
            [u.service_type || null, u.contact || null, u.expire_date || null, u.total_devices || null, u.data_limit_gb || null, u.remark || null, u.display_pos || null, existingId]\
          );\
        } else {\
          // Insert or update by ID\
          await client.query(\
            `INSERT INTO users (id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, created_at)\
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, now()))\
             ON CONFLICT (id) DO UPDATE SET server_id = EXCLUDED.server_id, account_name = EXCLUDED.account_name, service_type = EXCLUDED.service_type, contact = EXCLUDED.contact, expire_date = EXCLUDED.expire_date, total_devices = EXCLUDED.total_devices, data_limit_gb = EXCLUDED.data_limit_gb, remark = EXCLUDED.remark, display_pos = EXCLUDED.display_pos`,\
            [u.id, u.server_id || null, u.account_name || null, u.service_type || null, u.contact || null, u.expire_date || null, u.total_devices || null, u.data_limit_gb || null, u.remark || null, u.display_pos || null, u.created_at || null]\
          );\
        }\
      }\
    }' "$TARGET_FILE"

echo "Fix applied. Restarting backend..."
systemctl restart cmp-backend
echo "Done!"
