#!/bin/bash
# fix-tiktok-rules.sh
# Changes TikTok rules from DIRECT to the main proxy group in all YAML config files.
# Run on the key server VPS: bash /srv/cmp/scripts/fix-tiktok-rules.sh

CONFIG_DIR="/srv/cmp/configs"
CHANGED=0
TOTAL=0

echo "=== TikTok Rule Fix: DIRECT → Proxy ==="
echo "Config directory: $CONFIG_DIR"
echo ""

for yaml_file in "$CONFIG_DIR"/*.yaml "$CONFIG_DIR"/*.yml; do
  [ -f "$yaml_file" ] || continue
  TOTAL=$((TOTAL + 1))

  filename=$(basename "$yaml_file")

  # Find the main proxy group name (first group with type: select)
  proxy_group=""
  in_groups=0
  last_name=""
  while IFS= read -r line; do
    if echo "$line" | grep -q '^proxy-groups:'; then
      in_groups=1
      continue
    fi
    if [ "$in_groups" -eq 1 ]; then
      # Detect next top-level key → stop
      if echo "$line" | grep -qE '^[a-zA-Z]'; then
        break
      fi
      # Capture group name
      if echo "$line" | grep -q '^\s*- name:'; then
        last_name=$(echo "$line" | sed 's/.*name:\s*["'"'"']\?\(.*\)["'"'"']\?\s*$/\1/' | sed 's/["'"'"']//g' | sed 's/\s*$//')
      fi
      # If this group is type: select, use its name
      if echo "$line" | grep -q '^\s*type:\s*select'; then
        if [ -n "$last_name" ]; then
          proxy_group="$last_name"
          break
        fi
      fi
    fi
  done < "$yaml_file"

  if [ -z "$proxy_group" ]; then
    echo "⚠️  $filename: No select proxy group found, skipping"
    continue
  fi

  # Count TikTok DIRECT rules before fix
  direct_count=$(grep -ciE 'tiktok.*,DIRECT|musical\.ly.*,DIRECT' "$yaml_file" 2>/dev/null || echo 0)

  if [ "$direct_count" -eq 0 ] 2>/dev/null; then
    echo "⏭️  $filename: No TikTok DIRECT rules (already proxy or absent)"
    continue
  fi

  # Replace TikTok/musical.ly DIRECT rules with the proxy group
  # Use | as sed delimiter to avoid conflicts with special chars
  sed -i \
    -e "/[Tt][Ii][Kk][Tt][Oo][Kk]/s|,DIRECT$|,${proxy_group}|" \
    -e "/[Mm][Uu][Ss][Ii][Cc][Aa][Ll]\.[Ll][Yy]/s|,DIRECT$|,${proxy_group}|" \
    "$yaml_file"

  # Verify
  remaining=$(grep -ciE 'tiktok.*,DIRECT|musical\.ly.*,DIRECT' "$yaml_file" 2>/dev/null || echo 0)

  echo "✅ $filename: $direct_count TikTok rules → \"$proxy_group\" (remaining DIRECT: $remaining)"
  CHANGED=$((CHANGED + 1))
done

echo ""
echo "=== Summary ==="
echo "Files scanned: $TOTAL"
echo "Files modified: $CHANGED"
echo ""
if [ "$CHANGED" -gt 0 ]; then
  echo "Done! Users will get the updated rules on their next subscription refresh."
fi
