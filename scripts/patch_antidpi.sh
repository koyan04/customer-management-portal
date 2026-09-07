#!/bin/bash

BLOCK="
# ── Anti-DPI / Censorship Evasion ──
tcp-concurrent: true
global-client-fingerprint: random
keep-alive-interval: 30
tls-fragment:
  enable: true
  length: \"10-30\"
  interval: \"10-20\"

# Fake-IP mode for maximum evasion
sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  override-destination: true
  sniff:
    HTTP:
      ports: [80, 8080-8880]
      override-destination: true
    TLS:
      ports: [443, 8443]
    QUIC:
      ports: [443, 8443]

dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - \"*.lan\"
    - \"*.local\"
    - localhost.ptlogin2.qq.com
    - \"+.stun.*.*\"
    - \"+.stun.*.*.*\"
    - \"+.stun.*.*.*.*\"
    - \"+.stun.*.*.*.*.*\"
    - dns.msftncsi.com
    - www.msftncsi.com
    - www.msftconnecttest.com
  nameserver:
    - https://9.9.9.9:5053/dns-query
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
  fallback:
    - https://dns.google/dns-query
    - https://1.0.0.1/dns-query
    - tls://1.1.1.1:853
    - tls://8.8.4.4:853
  fallback-filter:
    geoip: true
    geoip-code: MM
    ipcidr:
      - 240.0.0.0/4
      - 0.0.0.0/32
      - 127.0.0.1/32
    domain:
      - \"+.google.com\"
      - \"+.facebook.com\"
      - \"+.youtube.com\"
      - \"+.twitter.com\"
      - \"+.instagram.com\"
      - \"+.whatsapp.com\"
"

for f in /srv/cmp/configs/*.yaml; do
    if ! grep -q "tcp-concurrent:" "$f"; then
        awk -v block="$BLOCK" '/^proxies:/ {print block; print ""; print $0; next} {print $0}' "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
        echo "Patched $f with Anti-DPI"
    else
        echo "Skipping $f - Anti-DPI block already exists"
    fi
done