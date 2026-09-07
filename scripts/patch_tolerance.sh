#!/bin/bash
CONFIG_DIR="/srv/cmp/configs"

if ! command -v jq >/dev/null 2>&1; then
    apt-get update && apt-get install -y jq
fi

echo "Patching YAML files..."
for file in "$CONFIG_DIR"/*.yaml; do
    if [[ -f "$file" ]]; then
        awk '
        BEGIN { in_auto = 0 }
        /^[ \t]*-[ \t]*name:.*Auto Switch/ { in_auto = 1; print; next }
        /^[ \t]*-[ \t]*name:/ { in_auto = 0 }
        in_auto && /^[ \t]*tolerance:[ \t]*[0-9]+/ {
            sub(/tolerance:[ \t]*[0-9]+/, "tolerance: 4")
            print
            next
        }
        { print }
        ' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    fi
done

echo "Patching JSON files..."
for file in "$CONFIG_DIR"/*.json; do
    if [[ -f "$file" ]]; then
        jq '.outbounds |= map(if type == "object" and .tag != null and (.tag | contains("Auto Switch")) then .tolerance = 4 else . end)' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    fi
done

echo "Done patching tolerances to 4ms!"
