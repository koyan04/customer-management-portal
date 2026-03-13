## What's Changed

### Bug Fix — SS prefix missing from subscription URIs

The Shadowsocks prefix (`%16%03%01%00%C2%A8%01%01`) was enabled in Anti-DPI settings but not appearing in the subscription URIs served by the keyserver.

**Root cause**: `convertNodeToSingbox` did not store the prefix in the sing-box outbound JSON for SS nodes. So when the keyserver converted the sing-box JSON to proxy URIs, `outboundToURI` had no prefix data to include.

**Fixes applied:**

1. `convertNodeToSingbox` (frontend): SS outbound now includes `_prefix` field when SS Prefix is enabled
2. `keyserver outboundToURI`: reads `ob._prefix` and emits the correct Outline/V2Box format
3. `nodeToURI` (frontend .txt export): updated to match the same format

**Expected SS URI format (with prefix enabled):**
```
ss://Y2hhY2hhMjAt...@pb01.vchannel.dpdns.org:21001/?outline=1&prefix=%16%03%01%00%C2%A8%01%01#VChannel Premium SG01
```

**To apply**: regenerate your JSON config (SS Prefix checkbox ON in Anti-DPI settings), then Save to Server again.

**Full Changelog**: https://github.com/koyan04/customer-management-portal/compare/v1.8.12...v1.8.13
