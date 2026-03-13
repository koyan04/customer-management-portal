import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaCog, FaPlus, FaTrash, FaCopy, FaSave, FaCheck, FaFileCode, FaShieldAlt, FaServer, FaSearch, FaUser, FaDownload } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { getBackendOrigin } from '../lib/backendOrigin';
import './JsonGeneratorPage.css';

const JsonGeneratorPage = () => {
  const { token } = useAuth();
  // Top menu settings
  const [groupName, setGroupName] = useState('VChannel-Premium');
  const [unlim, setUnlim] = useState(false);
  const [dataLimit, setDataLimit] = useState(150); // GB, used when unlim is false
  const [alsoSaveTxt, setAlsoSaveTxt] = useState(false);
  const [loadBalance, setLoadBalance] = useState(false);
  const [staticBalance, setStaticBalance] = useState(false);
  const [expireDate, setExpireDate] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Advanced settings
  const [updateInterval, setUpdateInterval] = useState(24);
  const [checkInterval, setCheckInterval] = useState(120);
  const [autoSwitchInterval, setAutoSwitchInterval] = useState(900);
  const [globalDefault, setGlobalDefault] = useState('Proxy');

  // Anti-DPI / Censorship evasion settings
  const [antiDPI, setAntiDPI] = useState(true);
  const [tcpConcurrent, setTcpConcurrent] = useState(true);
  const [clientFingerprint, setClientFingerprint] = useState('random');
  const [allowInsecure, setAllowInsecure] = useState(true);
  const [forceAlpn, setForceAlpn] = useState(true);
  const [dohEnabled, setDohEnabled] = useState(true);
  const [dohServer, setDohServer] = useState('https://1.1.1.1/dns-query');
  const [fakeDNS, setFakeDNS] = useState(false);
  const [tlsFragment, setTlsFragment] = useState(false);
  const [fragmentLength, setFragmentLength] = useState('10-30');
  const [fragmentInterval, setFragmentInterval] = useState('10-20');
  const [ssPrefix, setSsPrefix] = useState(false);
  const [ssPrefixValue, setSsPrefixValue] = useState('%16%03%01%00%C2%A8%01%01');

  // Server management
  const [bulkInput, setBulkInput] = useState('');
  const [singleInput, setSingleInput] = useState('');
  const [activeNodes, setActiveNodes] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [domainServers, setDomainServers] = useState([]);

  // Filename fields
  const [filePrefix, setFilePrefix] = useState(() => localStorage.getItem('json_file_prefix') || 'vchannel-config');
  const [fileSuffix, setFileSuffix] = useState('');

  // User search
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const userSearchRef = useRef(null);
  const userSearchTimer = useRef(null);

  // Routing rules
  const [customDomainInput, setCustomDomainInput] = useState('');
  const [proxyRules, setProxyRules] = useState([]);
  const [directRules, setDirectRules] = useState([]);

  // User search handler
  const searchUsers = useCallback(async (term) => {
    if (!term || term.trim().length < 2) {
      setUserResults([]);
      return;
    }
    setUserSearchLoading(true);
    try {
      const backendOrigin = getBackendOrigin();
      const res = await axios.get(`${backendOrigin}/api/users/search`, {
        params: { q: term.trim() },
        headers: { Authorization: `Bearer ${token}` }
      });
      setUserResults(Array.isArray(res.data) ? res.data.slice(0, 20) : []);
      setShowUserDropdown(true);
    } catch (err) {
      setUserResults([]);
    } finally {
      setUserSearchLoading(false);
    }
  }, [token]);

  const handleUserSearchChange = (e) => {
    const val = e.target.value;
    setUserSearch(val);
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current);
    userSearchTimer.current = setTimeout(() => searchUsers(val), 300);
  };

  const selectUser = (user) => {
    setSelectedUser(user);
    const name = (user.account_name || '').toLowerCase().replace(/[\s_]+/g, '');
    setFileSuffix(name);
    setUserSearch(user.account_name);
    if (user.expire_date) {
      const d = user.expire_date.substring(0, 10);
      setExpireDate(d);
    }
    setShowUserDropdown(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (userSearchRef.current && !userSearchRef.current.contains(e.target)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // App routing
  const [appRouting, setAppRouting] = useState({
    'Netflix': 'proxy',
    'YouTube': 'proxy',
    'Facebook': 'proxy',
    'Instagram': 'proxy',
    'Messenger': 'proxy',
    'Threads': 'proxy',
    'Twitter': 'proxy',
    'TikTok': 'proxy',
    'WhatsApp': 'proxy',
    'Telegram': 'proxy',
    'Signal': 'proxy',
    'Discord': 'proxy',
    'Spotify': 'proxy',
    'Google': 'direct',
    'Microsoft': 'direct',
    'Apple': 'direct',
    'Amazon': 'direct',
    'ChatGPT': 'proxy',
    'GitHub': 'proxy',
  });

  // UI state
  const [copied, setCopied] = useState(false);
  const [generatedJson, setGeneratedJson] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [antiDPISaved, setAntiDPISaved] = useState(false);
  const [appRoutingSaved, setAppRoutingSaved] = useState(false);

  // Load saved settings from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('json_advanced_settings'));
      if (saved) {
        if (saved.updateInterval != null) setUpdateInterval(saved.updateInterval);
        if (saved.checkInterval != null) setCheckInterval(saved.checkInterval);
        if (saved.autoSwitchInterval != null) setAutoSwitchInterval(saved.autoSwitchInterval);
        if (saved.globalDefault) setGlobalDefault(saved.globalDefault);
      }
    } catch (_) {}
    try {
      const saved = JSON.parse(localStorage.getItem('json_antidpi_settings'));
      if (saved) {
        if (saved.tcpConcurrent != null) setTcpConcurrent(saved.tcpConcurrent);
        if (saved.clientFingerprint) setClientFingerprint(saved.clientFingerprint);
        if (saved.allowInsecure != null) setAllowInsecure(saved.allowInsecure);
        if (saved.forceAlpn != null) setForceAlpn(saved.forceAlpn);
        if (saved.dohEnabled != null) setDohEnabled(saved.dohEnabled);
        if (saved.dohServer) setDohServer(saved.dohServer);
        if (saved.fakeDNS != null) setFakeDNS(saved.fakeDNS);
        if (saved.tlsFragment != null) setTlsFragment(saved.tlsFragment);
        if (saved.fragmentLength) setFragmentLength(saved.fragmentLength);
        if (saved.fragmentInterval) setFragmentInterval(saved.fragmentInterval);
        if (saved.ssPrefix != null) setSsPrefix(saved.ssPrefix);
        if (saved.ssPrefixValue) setSsPrefixValue(saved.ssPrefixValue);
      }
    } catch (_) {}
    try {
      const saved = JSON.parse(localStorage.getItem('json_app_routing'));
      if (saved) setAppRouting(prev => ({ ...prev, ...saved }));
    } catch (_) {}
  }, []);

  const saveAdvancedSettings = () => {
    localStorage.setItem('json_advanced_settings', JSON.stringify({
      updateInterval, checkInterval, autoSwitchInterval, globalDefault
    }));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  const saveAntiDPISettings = () => {
    localStorage.setItem('json_antidpi_settings', JSON.stringify({
      antiDPI, tcpConcurrent, clientFingerprint, allowInsecure, forceAlpn,
      dohEnabled, dohServer, fakeDNS, tlsFragment, fragmentLength, fragmentInterval,
      ssPrefix, ssPrefixValue
    }));
    setAntiDPISaved(true);
    setTimeout(() => setAntiDPISaved(false), 2000);
  };

  const saveAppRouting = () => {
    localStorage.setItem('json_app_routing', JSON.stringify(appRouting));
    setAppRoutingSaved(true);
    setTimeout(() => setAppRoutingSaved(false), 2000);
  };

  // Regional emoji mapping
  const FLAG_MAP = {
    'SG': '🇸🇬', 'HK': '🇭🇰', 'US': '🇺🇸', 'JP': '🇯🇵',
    'ID': '🇮🇩', 'TH': '🇹🇭', 'VN': '🇻🇳', 'UK': '🇬🇧',
    'CN': '🇨🇳', 'IN': '🇮🇳', 'AU': '🇦🇺'
  };

  // Fetch domain servers from backend
  useEffect(() => {
    const fetchDomainServers = async () => {
      try {
        const backendOrigin = getBackendOrigin();
        const response = await axios.get(`${backendOrigin}/api/domains`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setDomainServers(response.data || []);
      } catch (error) {
        console.error('Error fetching domain servers:', error);
        setDomainServers([]);
      }
    };
    if (token) fetchDomainServers();
  }, [token]);

  // Filter servers based on unlimited checkbox
  const filteredServers = domainServers.filter(s => {
    if (unlim) return s.unlimited === true;
    return s.service === 'Premium' && !s.unlimited;
  });

  // Reset selected server when filter changes
  useEffect(() => {
    setSelectedServer('');
  }, [unlim]);

  // Parse proxy URI
  const parseProxyURI = (uri) => {
    try {
      uri = uri.replace(/\s+(?=#)/g, '');
      if (uri.startsWith('ss://')) return parseShadowsocks(uri);
      if (uri.startsWith('vmess://')) return parseVMess(uri);
      if (uri.startsWith('vless://')) return parseVLESS(uri);
      if (uri.startsWith('trojan://')) return parseTrojan(uri);
      if (uri.startsWith('hy2://') || uri.startsWith('hysteria2://')) return parseHysteria2(uri);
      return null;
    } catch (error) {
      console.error('Parse error:', error);
      return null;
    }
  };

  const parseShadowsocks = (uri) => {
    const url = new URL(uri);
    const userinfo = atob(url.username);
    const [cipher, password] = userinfo.split(':');
    const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
    return {
      name: addFlag(name),
      type: 'ss',
      server: url.hostname,
      port: parseInt(url.port),
      cipher,
      password,
      udp: true
    };
  };

  const parseVMess = (uri) => {
    const json = JSON.parse(atob(uri.substring(8)));
    const node = {
      name: addFlag(json.ps || json.add),
      type: 'vmess',
      server: json.add,
      port: parseInt(json.port),
      uuid: json.id,
      alterId: parseInt(json.aid || 0),
      cipher: json.scy || 'auto',
      udp: true,
      'skip-cert-verify': true
    };
    if (json.net) node.network = json.net;
    if (json.tls === 'tls') node.tls = true;
    if (json.host) node.servername = json.host;
    if (json.net === 'ws') {
      node['ws-opts'] = {
        path: json.path || '/',
        headers: { Host: json.host || json.add }
      };
    }
    return node;
  };

  const parseVLESS = (uri) => {
    const url = new URL(uri);
    const params = new URLSearchParams(url.search);
    const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
    const node = {
      name: addFlag(name),
      type: 'vless',
      server: url.hostname,
      port: parseInt(url.port),
      uuid: url.username,
      udp: true,
      'skip-cert-verify': true,
      'client-fingerprint': params.get('fp') || 'chrome'
    };
    const network = params.get('type') || params.get('network');
    if (network) node.network = network;
    if (params.get('security') === 'tls') {
      node.tls = true;
      if (params.get('sni')) node.servername = params.get('sni');
      if (params.get('fp')) node['client-fingerprint'] = params.get('fp');
      const flow = params.get('flow');
      if (flow && flow.trim()) node.flow = flow;
    } else if (params.get('security') === 'reality') {
      node.security = 'reality';
      if (params.get('sni')) node.servername = params.get('sni');
      if (params.get('pbk')) node.publicKey = params.get('pbk');
      if (params.get('sid') !== null) node.shortId = params.get('sid');
      if (params.get('spx')) node.spiderX = decodeURIComponent(params.get('spx'));
      if (params.get('fp')) node['client-fingerprint'] = params.get('fp');
      const flow = params.get('flow');
      if (flow && flow.trim()) node.flow = flow;
    }
    if (network === 'ws') {
      node.udp = false;
      node.alpn = ['http/1.1'];
      node['ws-opts'] = {
        path: params.get('path') || '/',
        headers: { Host: params.get('host') || url.hostname }
      };
    }
    return node;
  };

  const parseTrojan = (uri) => {
    const url = new URL(uri);
    const params = new URLSearchParams(url.search);
    const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
    const node = {
      name: addFlag(name),
      type: 'trojan',
      server: url.hostname,
      port: parseInt(url.port),
      password: url.username,
      udp: true,
      'skip-cert-verify': true
    };
    if (params.get('sni')) node.sni = params.get('sni');
    if (params.get('type')) node.network = params.get('type');
    if (node.network === 'ws') {
      node['ws-opts'] = {
        path: params.get('path') || '/',
        headers: { Host: params.get('host') || url.hostname }
      };
    }
    return node;
  };

  const parseHysteria2 = (uri) => {
    const url = new URL(uri.replace('hy2://', 'hysteria2://'));
    const params = new URLSearchParams(url.search);
    const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
    return {
      name: addFlag(name),
      type: 'hysteria2',
      server: url.hostname,
      port: parseInt(url.port),
      password: url.username,
      udp: true,
      'skip-cert-verify': true,
      sni: params.get('sni') || url.hostname
    };
  };

  // Convert a Clash-format node object back to a proxy URI string
  const nodeToURI = (node) => {
    try {
      const name = (node.name || '').replace(/^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]+\s*/u, ''); // strip flag emoji
      if (node.type === 'vmess') {
        const json = { v: '2', ps: name, add: node.server, port: String(node.port), id: node.uuid, aid: String(node.alterId || 0), scy: node.cipher || 'auto', net: node.network || 'tcp', type: 'none', host: '', path: '', tls: node.tls ? 'tls' : '' };
        if (node.servername) json.host = node.servername;
        if (node['ws-opts']) { json.path = node['ws-opts'].path || '/'; json.host = node['ws-opts'].headers?.Host || json.host; }
        return 'vmess://' + btoa(JSON.stringify(json));
      }
      if (node.type === 'vless') {
        const params = new URLSearchParams();
        if (node.network) params.set('type', node.network);
        if (node.security === 'reality') {
          params.set('security', 'reality');
          if (node.servername) params.set('sni', node.servername);
          if (node.publicKey) params.set('pbk', node.publicKey);
          if (node.shortId !== undefined) params.set('sid', node.shortId);
          if (node.spiderX) params.set('spx', node.spiderX);
        } else if (node.tls) {
          params.set('security', 'tls');
          if (node.servername) params.set('sni', node.servername);
        }
        if (node['client-fingerprint']) params.set('fp', node['client-fingerprint']);
        if (node.flow) params.set('flow', node.flow);
        if (node['ws-opts']) { params.set('path', node['ws-opts'].path || '/'); params.set('host', node['ws-opts'].headers?.Host || node.server); }
        return `vless://${node.uuid}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(name)}`;
      }
      if (node.type === 'trojan') {
        const params = new URLSearchParams();
        if (node.sni) params.set('sni', node.sni);
        if (node.network) params.set('type', node.network);
        if (node['ws-opts']) { params.set('path', node['ws-opts'].path || '/'); params.set('host', node['ws-opts'].headers?.Host || node.server); }
        return `trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(name)}`;
      }
      if (node.type === 'ss') {
        const userinfo = btoa(`${node.cipher}:${node.password}`);
        if (ssPrefix && ssPrefixValue) {
          return `ss://${userinfo}@${node.server}:${node.port}/?outline=1&prefix=${ssPrefixValue}#${encodeURIComponent(name)}`;
        }
        return `ss://${userinfo}@${node.server}:${node.port}#${encodeURIComponent(name)}`;
      }
      if (node.type === 'hysteria2' || node.type === 'hy2') {
        const params = new URLSearchParams();
        if (node.sni) params.set('sni', node.sni);
        return `hy2://${encodeURIComponent(node.password)}@${node.server}:${node.port}?${params.toString()}#${encodeURIComponent(name)}`;
      }
      return `# unsupported type: ${node.type}`;
    } catch (e) { return `# error converting node: ${node.name || 'unknown'}`; }
  };

  const exportNodesAsText = () => {
    if (!activeNodes.length) return;
    const text = activeNodes.map(n => nodeToURI(n)).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const suffix = fileSuffix.trim();
    const filename = suffix ? `${suffix}.txt` : 'keys.txt';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Generate V2Box plain-text subscription (//profile-title / //subscription-userinfo headers + proxy URIs)
  const generateV2BoxSubscription = () => {
    const lines = [];
    const titleName = groupName || 'VChannel-Premium';
    lines.push(`//profile-title: ${titleName}`);
    lines.push(`//profile-update-interval: ${updateInterval}`);

    // Compute total bytes and expire Unix timestamp
    const limitGb = unlim ? 500 : dataLimit;
    let total = Math.round(limitGb * 1073741824);
    let expire = 0;

    const userDataLimitGb = selectedUser?.data_limit_gb;
    if (userDataLimitGb) {
      total = Math.round(userDataLimitGb * 1073741824);
    }

    const expireDateStr = expireDate || selectedUser?.expire_date?.substring(0, 10);
    if (expireDateStr) {
      // Parse as local midnight to avoid UTC off-by-one
      expire = Math.floor(new Date(expireDateStr + 'T00:00:00').getTime() / 1000);
    }

    lines.push(`//subscription-userinfo: upload=0; download=0; total=${total}; expire=${expire}`);
    lines.push('');

    // One proxy URI per line
    activeNodes.forEach(node => {
      lines.push(nodeToURI(node));
    });

    return lines.join('\n');
  };

  const downloadV2BoxSub = () => {
    if (!activeNodes.length) return;
    const content = generateV2BoxSubscription();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const prefix = filePrefix.trim() || 'vchannel-config';
    const suffix = fileSuffix.trim();
    const filename = suffix ? `${prefix}-${suffix}.txt` : `${prefix}.txt`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const addFlag = (name) => {
    for (const [code, emoji] of Object.entries(FLAG_MAP)) {
      if (name.toUpperCase().includes(code)) return `${emoji} ${name}`;
    }
    return name;
  };

  const applyDomainAutoIncrement = (nodes) => {
    const serverCounts = {};
    nodes.forEach(node => { serverCounts[node.server] = (serverCounts[node.server] || 0) + 1; });
    const incrementedServers = {};
    return nodes.map(node => {
      if (serverCounts[node.server] > 1) {
        const match = node.server.match(/^(pb|pul|ou|ps)(\d+)(.*)/i);
        if (match) {
          const [, prefix, , suffix] = match;
          incrementedServers[node.server] = incrementedServers[node.server] || 0;
          incrementedServers[node.server]++;
          const newNum = String(incrementedServers[node.server]).padStart(2, '0');
          const newServer = `${prefix}${newNum}${suffix}`;
          const newNode = { ...node, server: newServer };
          if (newNode['ws-opts']?.headers?.Host === node.server) newNode['ws-opts'].headers.Host = newServer;
          if (newNode.servername === node.server) newNode.servername = newServer;
          return newNode;
        }
      }
      return node;
    });
  };

  const deduplicateNames = (nodes) => {
    const nameCounts = {};
    nodes.forEach(node => { nameCounts[node.name] = (nameCounts[node.name] || 0) + 1; });
    const nameIndices = {};
    return nodes.map(node => {
      if (nameCounts[node.name] > 1) {
        nameIndices[node.name] = nameIndices[node.name] || 0;
        const letter = String.fromCharCode(65 + nameIndices[node.name]);
        nameIndices[node.name]++;
        return { ...node, name: `${node.name} ${letter}` };
      }
      return node;
    });
  };

  const processBulkKeys = () => {
    const lines = bulkInput.split('\n').filter(line => line.trim());
    const newNodes = [];
    lines.forEach(line => {
      const parsed = parseProxyURI(line.trim());
      if (parsed) newNodes.push(parsed);
    });
    if (newNodes.length > 0) {
      let processed = applyDomainAutoIncrement(newNodes);
      processed = deduplicateNames(processed);
      setActiveNodes([...activeNodes, ...processed]);
      setBulkInput('');
    }
  };

  const addSingleNode = () => {
    if (!singleInput.trim()) return;
    const parsed = parseProxyURI(singleInput.trim());
    if (parsed) {
      if (selectedServer) {
        const serverEntry = domainServers.find(s => s.id === parseInt(selectedServer));
        if (serverEntry) {
          parsed.server = serverEntry.domain;
          if (parsed['ws-opts']?.headers?.Host) parsed['ws-opts'].headers.Host = serverEntry.domain;
          if (parsed.servername) parsed.servername = serverEntry.domain;
          if (parsed.sni) parsed.sni = serverEntry.domain;
          const countryMatch = serverEntry.server.match(/^([A-Z]{2})/i);
          const countryCode = countryMatch ? countryMatch[1].toUpperCase() : '';
          const flag = FLAG_MAP[countryCode] || '';
          const displayGroupName = groupName || 'VChannel';
          const unlimLabel = serverEntry.unlimited ? ' (Unlimited)' : '';
          const suffix = `${displayGroupName}${unlimLabel} ${serverEntry.server}`;
          parsed.name = `${flag} ${suffix}`.trim();
        }
      }
      let newNodes = [...activeNodes, parsed];
      newNodes = deduplicateNames(newNodes);
      setActiveNodes(newNodes);
      setSingleInput('');
    }
  };

  const removeNode = (index) => {
    setActiveNodes(activeNodes.filter((_, i) => i !== index));
  };

  const addCustomRule = (target) => {
    if (!customDomainInput.trim()) return;
    const domains = customDomainInput.split(',').map(d => d.trim()).filter(d => d);
    if (target === 'proxy') {
      setProxyRules([...proxyRules, ...domains]);
    } else {
      setDirectRules([...directRules, ...domains]);
    }
    setCustomDomainInput('');
  };

  const toggleAppRoute = (app) => {
    setAppRouting({ ...appRouting, [app]: appRouting[app] === 'proxy' ? 'direct' : 'proxy' });
  };

  // App domain mappings (same as YAML generator)
  const appDomains = {
    'Netflix': ['DOMAIN-SUFFIX,netflix.com', 'DOMAIN-SUFFIX,nflxvideo.net', 'DOMAIN-SUFFIX,nflximg.net', 'DOMAIN-SUFFIX,nflxext.com', 'DOMAIN-SUFFIX,nflxso.net'],
    'YouTube': ['DOMAIN-SUFFIX,youtube.com', 'DOMAIN-SUFFIX,googlevideo.com', 'DOMAIN-SUFFIX,ytimg.com', 'DOMAIN-SUFFIX,yt.be', 'DOMAIN-SUFFIX,youtu.be', 'DOMAIN-SUFFIX,youtube-nocookie.com', 'DOMAIN-SUFFIX,yt3.ggpht.com'],
    'Facebook': [
      'DOMAIN-SUFFIX,facebook.com', 'DOMAIN-SUFFIX,fbcdn.net', 'DOMAIN-SUFFIX,fb.com', 'DOMAIN-SUFFIX,fb.me',
      'DOMAIN-SUFFIX,fbsbx.com', 'DOMAIN-SUFFIX,fbpigeon.com', 'DOMAIN-SUFFIX,fb.gg',
      'DOMAIN-SUFFIX,facebook.net', 'DOMAIN-SUFFIX,facebookcorewwwi.onion',
      'DOMAIN-SUFFIX,accountkit.com', 'DOMAIN-SUFFIX,freebasics.com',
      'DOMAIN-KEYWORD,facebook', 'DOMAIN-KEYWORD,fbcdn',
      'IP-CIDR,31.13.24.0/21,no-resolve', 'IP-CIDR,31.13.64.0/18,no-resolve',
      'IP-CIDR,45.64.40.0/22,no-resolve', 'IP-CIDR,66.220.144.0/20,no-resolve',
      'IP-CIDR,69.63.176.0/20,no-resolve', 'IP-CIDR,69.171.224.0/19,no-resolve',
      'IP-CIDR,74.119.76.0/22,no-resolve', 'IP-CIDR,102.132.96.0/20,no-resolve',
      'IP-CIDR,103.4.96.0/22,no-resolve', 'IP-CIDR,129.134.0.0/17,no-resolve',
      'IP-CIDR,157.240.0.0/17,no-resolve', 'IP-CIDR,173.252.64.0/18,no-resolve',
      'IP-CIDR,179.60.192.0/22,no-resolve', 'IP-CIDR,185.60.216.0/22,no-resolve',
      'IP-CIDR,185.89.218.0/23,no-resolve', 'IP-CIDR,204.15.20.0/22,no-resolve',
      'IP-CIDR6,2620:0:1c00::/40,no-resolve', 'IP-CIDR6,2a03:2880::/32,no-resolve'
    ],
    'Instagram': ['DOMAIN-SUFFIX,instagram.com', 'DOMAIN-SUFFIX,cdninstagram.com', 'DOMAIN-SUFFIX,ig.me', 'DOMAIN-SUFFIX,instagram.net', 'DOMAIN-KEYWORD,instagram'],
    'Twitter': ['DOMAIN-SUFFIX,twitter.com', 'DOMAIN-SUFFIX,twimg.com', 'DOMAIN-SUFFIX,x.com', 'DOMAIN-SUFFIX,t.co', 'DOMAIN-SUFFIX,twittercdn.com', 'DOMAIN-SUFFIX,twitterstat.us', 'DOMAIN-SUFFIX,twttr.com', 'DOMAIN-KEYWORD,twitter'],
    'TikTok': ['DOMAIN-SUFFIX,tiktok.com', 'DOMAIN-SUFFIX,tiktokcdn.com', 'DOMAIN-SUFFIX,tiktokv.com', 'DOMAIN-SUFFIX,tiktokcdn-us.com', 'DOMAIN-SUFFIX,musical.ly', 'DOMAIN-KEYWORD,tiktok'],
    'WhatsApp': ['DOMAIN-SUFFIX,whatsapp.com', 'DOMAIN-SUFFIX,whatsapp.net', 'DOMAIN-SUFFIX,wa.me', 'DOMAIN-KEYWORD,whatsapp',
      'IP-CIDR,18.194.0.0/15,no-resolve', 'IP-CIDR,34.224.0.0/12,no-resolve',
      'IP-CIDR,50.19.0.0/16,no-resolve', 'IP-CIDR,52.0.0.0/11,no-resolve'],
    'Telegram': ['DOMAIN-SUFFIX,telegram.org', 'DOMAIN-SUFFIX,t.me', 'DOMAIN-SUFFIX,telegra.ph', 'DOMAIN-SUFFIX,telegram.me', 'DOMAIN-SUFFIX,telegram.dog', 'DOMAIN-SUFFIX,telesco.pe',
      'IP-CIDR,91.108.4.0/22,no-resolve', 'IP-CIDR,91.108.8.0/21,no-resolve',
      'IP-CIDR,91.108.16.0/21,no-resolve', 'IP-CIDR,91.108.56.0/22,no-resolve',
      'IP-CIDR,95.161.64.0/20,no-resolve', 'IP-CIDR,149.154.160.0/20,no-resolve',
      'IP-CIDR6,2001:67c:4e8::/48,no-resolve', 'IP-CIDR6,2001:b28:f23d::/48,no-resolve'],
    'Discord': ['DOMAIN-SUFFIX,discord.com', 'DOMAIN-SUFFIX,discordapp.com', 'DOMAIN-SUFFIX,discordapp.net', 'DOMAIN-SUFFIX,discord.gg', 'DOMAIN-SUFFIX,discord.media', 'DOMAIN-KEYWORD,discord'],
    'Spotify': ['DOMAIN-SUFFIX,spotify.com', 'DOMAIN-SUFFIX,scdn.co', 'DOMAIN-SUFFIX,spotify.design', 'DOMAIN-SUFFIX,spotifycdn.com'],
    'Google': ['DOMAIN-SUFFIX,google.com', 'DOMAIN-SUFFIX,googleapis.com', 'DOMAIN-SUFFIX,gstatic.com'],
    'Microsoft': ['DOMAIN-SUFFIX,microsoft.com', 'DOMAIN-SUFFIX,live.com', 'DOMAIN-SUFFIX,msn.com'],
    'Apple': ['DOMAIN-SUFFIX,apple.com', 'DOMAIN-SUFFIX,icloud.com'],
    'Amazon': ['DOMAIN-SUFFIX,amazon.com', 'DOMAIN-SUFFIX,amazonaws.com'],
    'ChatGPT': ['DOMAIN-SUFFIX,openai.com', 'DOMAIN-SUFFIX,chatgpt.com', 'DOMAIN-SUFFIX,oaistatic.com', 'DOMAIN-SUFFIX,oaiusercontent.com'],
    'GitHub': ['DOMAIN-SUFFIX,github.com', 'DOMAIN-SUFFIX,githubusercontent.com', 'DOMAIN-SUFFIX,github.io', 'DOMAIN-SUFFIX,githubassets.com'],
    'Messenger': ['DOMAIN-SUFFIX,messenger.com', 'DOMAIN-SUFFIX,m.me', 'DOMAIN-SUFFIX,msngr.com', 'DOMAIN-KEYWORD,messenger',
      'IP-CIDR,69.171.250.0/24,no-resolve', 'IP-CIDR,31.13.86.0/24,no-resolve'],
    'Threads': ['DOMAIN-SUFFIX,threads.net', 'DOMAIN-SUFFIX,threads.com', 'DOMAIN-KEYWORD,threads'],
    'Signal': ['DOMAIN-SUFFIX,signal.org', 'DOMAIN-SUFFIX,whispersystems.org', 'DOMAIN-SUFFIX,signal.art',
      'IP-CIDR,13.248.212.0/24,no-resolve', 'IP-CIDR,76.223.92.0/24,no-resolve'],
  };

  // ── sing-box format helpers ──

  // Build sing-box tls block: covers regular TLS and REALITY, with utls/ALPN/allowInsecure
  const buildSingboxTLS = (node, networkType) => {
    const isReality = node.security === 'reality';
    const needsTLS = node.tls === true || node.type === 'trojan' || node.type === 'hysteria2';
    if (!isReality && !needsTLS) return null;

    const sni = node.servername || node.sni || node.server;
    const tls = {
      enabled: true,
      insecure: isReality ? false : (antiDPI ? allowInsecure : (node['skip-cert-verify'] !== false)),
      server_name: sni
    };

    if (isReality) {
      tls.reality = {
        enabled: true,
        public_key: node.publicKey || '',
        short_id: node.shortId !== undefined ? node.shortId : ''
      };
      tls.utls = { enabled: true, fingerprint: antiDPI ? clientFingerprint : (node['client-fingerprint'] || 'chrome') };
    } else {
      const fp = antiDPI ? clientFingerprint : (node['client-fingerprint'] || clientFingerprint);
      tls.utls = { enabled: true, fingerprint: fp };
      if (forceAlpn || node.alpn) {
        const defaultAlpn = networkType === 'ws' ? ['http/1.1'] : ['h2', 'http/1.1'];
        tls.alpn = node.alpn
          ? (Array.isArray(node.alpn) ? node.alpn : [node.alpn])
          : defaultAlpn;
      }
    }
    return tls;
  };

  // Convert internal node object to sing-box outbound format
  const convertNodeToSingbox = (node) => {
    const tag = node.name;
    const network = node.network || 'tcp';

    switch (node.type) {
      case 'ss': {
        const ssOut = { type: 'shadowsocks', tag, server: node.server, server_port: node.port, method: node.cipher, password: node.password, udp_over_tcp: false };
        if (ssPrefix && ssPrefixValue) ssOut._prefix = ssPrefixValue;
        return ssOut;
      }

      case 'vmess': {
        const out = { type: 'vmess', tag, server: node.server, server_port: node.port, uuid: node.uuid, alter_id: node.alterId || 0, security: node.cipher || 'auto' };
        const tls = buildSingboxTLS(node, network);
        if (tls) out.tls = tls;
        if (network === 'ws') out.transport = { type: 'ws', path: node['ws-opts']?.path || '/', headers: { Host: node['ws-opts']?.headers?.Host || node.server } };
        else if (network === 'grpc') out.transport = { type: 'grpc', service_name: node['grpc-opts']?.['grpc-service-name'] || '' };
        else if (network === 'h2') out.transport = { type: 'http', path: node['h2-opts']?.path || '/', host: node['h2-opts']?.host || [node.server] };
        else if (network === 'httpupgrade') out.transport = { type: 'httpupgrade', path: node['httpupgrade-opts']?.path || '/', host: node.server };
        return out;
      }

      case 'vless': {
        const out = { type: 'vless', tag, server: node.server, server_port: node.port, uuid: node.uuid };
        if (node.flow) out.flow = node.flow;
        const tls = buildSingboxTLS(node, network);
        if (tls) out.tls = tls;
        if (network === 'ws') out.transport = { type: 'ws', path: node['ws-opts']?.path || '/', headers: { Host: node['ws-opts']?.headers?.Host || node.server } };
        return out;
      }

      case 'trojan': {
        const out = { type: 'trojan', tag, server: node.server, server_port: node.port, password: node.password };
        const tls = buildSingboxTLS(node, network);
        if (tls) out.tls = tls;
        if (network === 'ws') out.transport = { type: 'ws', path: node['ws-opts']?.path || '/', headers: { Host: node['ws-opts']?.headers?.Host || node.server } };
        return out;
      }

      case 'hysteria2': {
        const out = { type: 'hysteria2', tag, server: node.server, server_port: node.port, password: node.password };
        out.tls = { enabled: true, insecure: antiDPI ? allowInsecure : (node['skip-cert-verify'] !== false), server_name: node.sni || node.servername || node.server, alpn: ['h3'] };
        if (antiDPI) out.tls.utls = { enabled: true, fingerprint: clientFingerprint };
        return out;
      }

      default:
        return { type: node.type, tag };
    }
  };

  const generateJSON = () => {
    const config = {};

    // ── Log ──
    config.log = { level: 'info' };

    // ── DNS ──
    if (antiDPI && dohEnabled) {
      const dnsConfig = {
        servers: [
          { tag: 'dns-remote', address: dohServer, detour: 'proxy' },
          { tag: 'dns-local', address: 'local', detour: 'direct' }
        ],
        final: 'dns-remote'
      };
      if (fakeDNS) dnsConfig.fakeip = { enabled: true, inet4_range: '198.18.0.0/15', inet6_range: 'fc00::/18' };
      config.dns = dnsConfig;
    } else {
      config.dns = { servers: [{ tag: 'default-dns', address: 'local' }], final: 'default-dns' };
    }

    // ── Inbounds ──
    config.inbounds = [
      {
        type: 'tun', tag: 'tun-in',
        inet4_address: '172.19.0.1/30',
        inet6_address: 'fdfe:dcba:9876::1/126',
        auto_route: true, strict_route: true,
        stack: 'mixed', sniff: true,
        auto_redirect_output_mark: 8872
      },
      { type: 'mixed', tag: 'mixed-in', listen: '::', listen_port: 7890, sniff: true }
    ];

    // ── Outbounds ──
    const nodeOutbounds = activeNodes.map(convertNodeToSingbox).filter(Boolean);
    const nodeTags = nodeOutbounds.map(n => n.tag);
    const interval = `${autoSwitchInterval}s`;

    config.outbounds = [
      { type: 'selector', tag: 'proxy', outbounds: ['♻️ Auto Switch', '⚡ Fastest', '🛡️ Failover', ...nodeTags, 'direct'], default: 'proxy' },
      { type: 'urltest', tag: '♻️ Auto Switch', outbounds: nodeTags, url: 'http://www.gstatic.com/generate_204', interval, tolerance: 150 },
      { type: 'urltest', tag: '⚡ Fastest', outbounds: nodeTags, url: 'http://www.gstatic.com/generate_204', interval: '120s', tolerance: 50 },
      { type: 'urltest', tag: '🛡️ Failover', outbounds: nodeTags, url: 'http://www.gstatic.com/generate_204', interval: '120s', tolerance: 300 },
      ...nodeOutbounds,
      { type: 'direct', tag: 'direct' },
      { type: 'dns', tag: 'dns-out' },
      { type: 'block', tag: 'block' }
    ];

    // ── Routing ──
    const proxyDomainSuffix = [], proxyDomainKeyword = [], proxyIpCidr = [];
    const directDomainSuffix = [], directDomainKeyword = [], directIpCidr = [];

    Object.entries(appRouting).forEach(([app, routeTarget]) => {
      const domains = appDomains[app] || [];
      const isProxy = routeTarget === 'proxy';
      domains.forEach(rule => {
        const parts = rule.split(',');
        const ruleType = parts[0]; const ruleValue = parts[1];
        if (ruleType === 'DOMAIN-SUFFIX') (isProxy ? proxyDomainSuffix : directDomainSuffix).push(ruleValue);
        else if (ruleType === 'DOMAIN-KEYWORD') (isProxy ? proxyDomainKeyword : directDomainKeyword).push(ruleValue);
        else if (ruleType === 'IP-CIDR' || ruleType === 'IP-CIDR6') (isProxy ? proxyIpCidr : directIpCidr).push(ruleValue);
      });
    });

    proxyRules.forEach(r => { if (/^\d+\.\d+\.\d+\.\d+/.test(r)) proxyIpCidr.push(`${r}/32`); else proxyDomainSuffix.push(r); });
    directRules.forEach(r => { if (/^\d+\.\d+\.\d+\.\d+/.test(r)) directIpCidr.push(`${r}/32`); else directDomainSuffix.push(r); });

    const routeRules = [
      { protocol: 'dns', outbound: 'dns-out' },
      { ip_is_private: true, outbound: 'direct' }
    ];
    if (proxyDomainSuffix.length > 0) routeRules.push({ domain_suffix: proxyDomainSuffix, outbound: 'proxy' });
    if (proxyDomainKeyword.length > 0) routeRules.push({ domain_keyword: proxyDomainKeyword, outbound: 'proxy' });
    if (proxyIpCidr.length > 0) routeRules.push({ ip_cidr: proxyIpCidr, outbound: 'proxy' });
    if (directDomainSuffix.length > 0) routeRules.push({ domain_suffix: directDomainSuffix, outbound: 'direct' });
    if (directDomainKeyword.length > 0) routeRules.push({ domain_keyword: directDomainKeyword, outbound: 'direct' });
    if (directIpCidr.length > 0) routeRules.push({ ip_cidr: directIpCidr, outbound: 'direct' });

    config.route = {
      rules: routeRules,
      final: globalDefault === 'Proxy' ? 'proxy' : 'direct',
      auto_detect_interface: true,
      final_ipv6: true
    };

    // ── Anti-DPI global settings ──
    if (antiDPI) {
      if (tcpConcurrent) config.dial_fields = { tcp_multi_path: true, tcp_fast_open: true };
      if (tlsFragment) config.tls_fragment = { enabled: true, size: fragmentLength, sleep: fragmentInterval };
    }

    // ── Experimental ──
    config.experimental = {
      clash_api: { external_controller: '127.0.0.1:9090' },
      cache_file: { enabled: true, store_fakeip: false }
    };

    const jsonStr = JSON.stringify(config, null, 2);
    setGeneratedJson(jsonStr);
    return jsonStr;
  };

  useEffect(() => {
    generateJSON();
  }, [activeNodes, groupName, unlim, dataLimit, loadBalance, staticBalance, expireDate,
      updateInterval, checkInterval, autoSwitchInterval, globalDefault,
      proxyRules, directRules, appRouting,
      antiDPI, tcpConcurrent, clientFingerprint, allowInsecure, forceAlpn,
      dohEnabled, dohServer, fakeDNS, tlsFragment, fragmentLength, fragmentInterval,
      ssPrefix, ssPrefixValue]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getCombinedFilename = () => {
    const prefix = filePrefix.trim() || 'vchannel-config';
    const suffix = fileSuffix.trim();
    return suffix ? `${prefix}-${suffix}.json` : `${prefix}.json`;
  };

  const saveFilePrefix = () => {
    localStorage.setItem('json_file_prefix', filePrefix);
  };

  const saveToFile = () => {
    const blob = new Blob([generatedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getCombinedFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [serverSaveStatus, setServerSaveStatus] = useState('');
  const [serverSaveMsg, setServerSaveMsg] = useState('');
  const [subUrls, setSubUrls] = useState(null); // { base: '', raw: '', v2ray: '' }

  const saveToServer = async () => {
    if (!generatedJson.trim()) return;
    setServerSaveStatus('saving');
    setServerSaveMsg('');
    try {
      const backendOrigin = getBackendOrigin();
      const jsonFilename = getCombinedFilename();
      const txtFilename = jsonFilename.replace(/\.json$/, '.txt');

      // Build subscription metadata for sing-box JSON save
      const metadata = {};
      if (selectedUser) {
        if (selectedUser.data_limit_gb) metadata.data_limit_gb = selectedUser.data_limit_gb;
        if (selectedUser.expire_date) metadata.expire_date = selectedUser.expire_date.substring(0, 10);
      } else {
        if (!unlim && dataLimit) metadata.data_limit_gb = dataLimit;
        if (expireDate) metadata.expire_date = expireDate;
      }
      if (unlim) metadata.unlimited = true;

      // Save sing-box JSON config
      const res = await axios.post(`${backendOrigin}/api/keyserver/keys`, {
        filename: jsonFilename,
        content: generatedJson,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Also save V2Box plain-text subscription (.txt) if checkbox is enabled
      let savedTxtToken = '';
      if (alsoSaveTxt && activeNodes.length > 0) {
        const v2boxContent = generateV2BoxSubscription();
        const txtRes = await axios.post(`${backendOrigin}/api/keyserver/keys`, {
          filename: txtFilename,
          content: v2boxContent
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        savedTxtToken = txtRes.data.token || txtRes.data.filename;
      }

      // Build subscription URLs from the JSON file token
      const jsonToken = res.data.token || res.data.filename;
      if (jsonToken) {
        const ksConfig = await axios.get(`${backendOrigin}/api/keyserver/config`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const ksPort = ksConfig.data.port || 8088;
        const ksKey = ksConfig.data.secretKey || '';
        const rawDomain = ksConfig.data.publicDomain || '';
        const normDomain = rawDomain
          ? (rawDomain.match(/^https?:\/\//) ? rawDomain : `http://${rawDomain}`).replace(/\/+$/, '')
          : '';
        const baseHost = normDomain || `http://${window.location.hostname}:${ksPort}`;
        const base = `${baseHost}/sub/${jsonToken}?key=${ksKey}`;
        setSubUrls({
          base,
          raw: `${base}&format=raw`,
          v2ray: `${base}&format=v2ray`
        });
      }

      setServerSaveStatus('saved');
      setServerSaveMsg(savedTxtToken
        ? `Saved ${res.data.filename} + ${txtFilename}`
        : `Saved as ${res.data.filename}`);
      setTimeout(() => { setServerSaveStatus(''); setServerSaveMsg(''); }, 3000);
    } catch (err) {
      setServerSaveStatus('error');
      setServerSaveMsg(err.response?.data?.error || 'Failed to save to server');
      setTimeout(() => { setServerSaveStatus(''); setServerSaveMsg(''); }, 3000);
    }
  };

  return (
    <div className="yaml-generator-page">
      <div className="page-header">
        <h1>
          <FaFileCode className="title-icon" />
          JSON Generator
        </h1>
      </div>

      {/* Top Menu Settings */}
      <div className="top-menu">
        <div className="top-menu-columns">
          <div className="top-menu-row">
            <div className="form-group">
              <label>Group Name:</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="VChannel-Premium"
              />
            </div>

            {/* Stacked checkboxes: Unlim on top, LB below */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={unlim}
                    onChange={(e) => setUnlim(e.target.checked)}
                  />
                  Unlim
                </label>
              </div>
              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={loadBalance}
                    onChange={(e) => setLoadBalance(e.target.checked)}
                  />
                  LB
                </label>
              </div>
              {loadBalance && (
                <div className="form-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={staticBalance}
                      onChange={(e) => setStaticBalance(e.target.checked)}
                    />
                    Static
                  </label>
                </div>
              )}
            </div>

          <div className="form-group">
            <label>Expire Date:</label>
            <input
              type="date"
              value={expireDate}
              onChange={(e) => setExpireDate(e.target.value)}
            />
          </div>

          {!unlim && (
            <div className="form-group">
              <label>Data Limit (GB):</label>
              <input
                type="number"
                min="1"
                value={dataLimit}
                onChange={(e) => setDataLimit(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ width: '80px' }}
              />
            </div>
          )}

          <button
            className={`settings-btn anti-dpi-btn ${antiDPI ? 'active' : ''}`}
            onClick={() => setAntiDPI(!antiDPI)}
            title="Anti-DPI / Censorship Evasion"
          >
            <FaShieldAlt />
          </button>

          <button
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Advanced Settings"
          >
            <FaCog />
          </button>
        </div>

          {/* User Search Column */}
          <div className="user-search-column" ref={userSearchRef}>
            <div className="form-group">
              <label><FaSearch className="label-icon" /> Search User:</label>
              <div className="user-search-wrapper">
                <input
                  type="text"
                  value={userSearch}
                  onChange={handleUserSearchChange}
                  onFocus={() => { if (userResults.length > 0) setShowUserDropdown(true); }}
                  placeholder="Type username..."
                  className="user-search-input"
                />
                {userSearchLoading && <span className="user-search-spinner" />}
                {showUserDropdown && userResults.length > 0 && (
                  <div className="user-search-dropdown">
                    {userResults.map(u => (
                      <div
                        key={u.id}
                        className={`user-search-item${selectedUser?.id === u.id ? ' selected' : ''}`}
                        onClick={() => selectUser(u)}
                      >
                        <span className="user-search-name"><FaUser className="user-icon" /> {u.account_name}</span>
                        <span className="user-search-meta">
                          {u.server_name && <span className="user-server-tag">{u.server_name}</span>}
                          {u.expire_date && <span className="user-expire-tag">{u.expire_date.substring(0, 10)}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {selectedUser && (
              <div className="selected-user-info">
                <FaUser className="user-icon" />
                <span className="selected-user-name">{selectedUser.account_name}</span>
                {selectedUser.service_type && <span className="selected-user-service">{selectedUser.service_type}</span>}
                {selectedUser.expire_date && <span className="selected-user-expire">{selectedUser.expire_date.substring(0, 10)}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Anti-DPI Settings Panel */}
        {antiDPI && (
          <div className="advanced-settings anti-dpi-settings">
            <h3><FaShieldAlt /> Anti-DPI / Censorship Evasion</h3>
            <p className="anti-dpi-hint">
              Bypass Deep Packet Inspection and throttling. Recommended for restricted networks.
            </p>
            <div className="settings-grid">
              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={tcpConcurrent}
                    onChange={(e) => setTcpConcurrent(e.target.checked)}
                  />
                  TCP Concurrent
                </label>
                <span className="setting-hint">Try multiple IPs simultaneously for faster connection</span>
              </div>

              <div className="form-group">
                <label>TLS Fingerprint:</label>
                <select
                  value={clientFingerprint}
                  onChange={(e) => setClientFingerprint(e.target.value)}
                >
                  <option value="random">Random (Best)</option>
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="safari">Safari</option>
                  <option value="edge">Edge</option>
                  <option value="ios">iOS</option>
                  <option value="android">Android</option>
                  <option value="360">360 Browser</option>
                  <option value="qq">QQ Browser</option>
                </select>
                <span className="setting-hint">Disguise TLS handshake as a normal browser</span>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={allowInsecure}
                    onChange={(e) => setAllowInsecure(e.target.checked)}
                  />
                  Allow Insecure TLS
                </label>
                <span className="setting-hint">Skip TLS certificate verification (V2Box: allow insecure). Required for VPN servers with self-signed certs.</span>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={forceAlpn}
                    onChange={(e) => setForceAlpn(e.target.checked)}
                  />
                  Force ALPN (h2 + http/1.1)
                </label>
                <span className="setting-hint">Set ALPN negotiation on every TLS node (V2Box: ALPN field). Helps bypass protocol-based DPI filters.</span>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={dohEnabled}
                    onChange={(e) => setDohEnabled(e.target.checked)}
                  />
                  DNS over HTTPS (DoH)
                </label>
                <span className="setting-hint">Encrypt DNS queries to prevent DNS poisoning</span>
              </div>

              {dohEnabled && (
                <div className="form-group">
                  <label>DoH Server:</label>
                  <select
                    value={dohServer}
                    onChange={(e) => setDohServer(e.target.value)}
                  >
                    <option value="https://1.1.1.1/dns-query">Cloudflare (1.1.1.1)</option>
                    <option value="https://dns.google/dns-query">Google DNS</option>
                    <option value="https://9.9.9.9:5053/dns-query">Quad9 (Secure)</option>
                    <option value="https://doh.opendns.com/dns-query">OpenDNS</option>
                    <option value="https://dns.adguard-dns.com/dns-query">AdGuard DNS</option>
                  </select>
                </div>
              )}

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={fakeDNS}
                    onChange={(e) => setFakeDNS(e.target.checked)}
                  />
                  Fake-IP Mode
                </label>
                <span className="setting-hint">Use fake IPs to avoid DNS leaks (faster, best for evasion)</span>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={tlsFragment}
                    onChange={(e) => setTlsFragment(e.target.checked)}
                  />
                  TLS Fragment
                </label>
                <span className="setting-hint">Split TLS ClientHello to bypass SNI-based DPI</span>
              </div>

              {tlsFragment && (
                <>
                  <div className="form-group">
                    <label>Fragment Length:</label>
                    <input
                      type="text"
                      value={fragmentLength}
                      onChange={(e) => setFragmentLength(e.target.value)}
                      placeholder="10-30"
                    />
                  </div>
                  <div className="form-group">
                    <label>Fragment Interval (ms):</label>
                    <input
                      type="text"
                      value={fragmentInterval}
                      onChange={(e) => setFragmentInterval(e.target.value)}
                      placeholder="10-20"
                    />
                  </div>
                </>
              )}

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={ssPrefix}
                    onChange={(e) => setSsPrefix(e.target.checked)}
                  />
                  SS Prefix
                </label>
                <span className="setting-hint">Prepend bytes to Shadowsocks connections to bypass DPI (appended to SS URI for V2Box)</span>
              </div>

              {ssPrefix && (
                <div className="form-group">
                  <label>Prefix Value:</label>
                  <input
                    type="text"
                    value={ssPrefixValue}
                    onChange={(e) => setSsPrefixValue(e.target.value)}
                    placeholder="%16%03%01%00%C2%A8%01%01"
                    style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
                  />
                  <span className="setting-hint">URL-encoded bytes prepended to each SS connection</span>
                </div>
              )}
            </div>
            <button className="btn-save-settings" onClick={saveAntiDPISettings}>
              {antiDPISaved ? <><FaCheck /> Saved!</> : <><FaSave /> Save Anti-DPI Settings</>}
            </button>
          </div>
        )}

        {showSettings && (
          <div className="advanced-settings">
            <h3>Advanced Settings</h3>
            <div className="settings-grid">
              <div className="form-group">
                <label>Update Interval (hours):</label>
                <input
                  type="number"
                  value={updateInterval}
                  onChange={(e) => setUpdateInterval(parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Health Check (s):</label>
                <input
                  type="number"
                  value={checkInterval}
                  onChange={(e) => setCheckInterval(parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Auto Switch (s):</label>
                <input
                  type="number"
                  value={autoSwitchInterval}
                  onChange={(e) => setAutoSwitchInterval(parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Global Default:</label>
                <select
                  value={globalDefault}
                  onChange={(e) => setGlobalDefault(e.target.value)}
                >
                  <option value="Proxy">Proxy</option>
                  <option value="Direct">Direct</option>
                </select>
              </div>
            </div>
            <button className="btn-save-settings" onClick={saveAdvancedSettings}>
              {settingsSaved ? <><FaCheck /> Saved!</> : <><FaSave /> Save Settings</>}
            </button>
          </div>
        )}
      </div>

      <div className="generator-content">
        <div className="left-column">
        {/* Step 1: Bulk Import */}
        <div className="step-section">
          <h2>Step 1: Bulk Import</h2>
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder="Paste your proxy links here (ss://, vmess://, vless://, trojan://, hy2://)"
            rows={6}
          />
          <div className="btn-row">
            <button className="btn-primary" onClick={processBulkKeys}>
              Process Keys
            </button>
            {bulkInput && (
              <button className="btn-delete-outline" onClick={() => setBulkInput('')}>
                <FaTrash /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Step 2: Add Single Node */}
        <div className="step-section">
          <h2>Step 2: Add Single Node</h2>
          <div className="input-group">
            <input
              type="text"
              value={singleInput}
              onChange={(e) => setSingleInput(e.target.value)}
              placeholder="Paste single proxy link"
            />
            <select
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="server-selector"
            >
              <option value="">-- Select Server --</option>
              {filteredServers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.server} — {s.domain} ({s.service}{s.unlimited ? ' Unlimited' : ''})
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={addSingleNode}>
              <FaPlus /> ADD
            </button>
          </div>
        </div>

        {/* Step 3: Custom Domain/IP */}
        <div className="step-section">
          <h2>Step 3: Custom Domain/IP</h2>
          <div className="input-group">
            <input
              type="text"
              value={customDomainInput}
              onChange={(e) => setCustomDomainInput(e.target.value)}
              placeholder="netflix.com, 1.1.1.1, facebook.com (comma-separated)"
            />
            <div className="btn-row">
              <button className="btn-success" onClick={() => addCustomRule('proxy')}>
                <FaPlus /> Add to Proxy
              </button>
              <button className="btn-info" onClick={() => addCustomRule('direct')}>
                <FaPlus /> Add to Direct
              </button>
            </div>
          </div>

          {(proxyRules.length > 0 || directRules.length > 0) && (
            <div className="rules-display">
              {proxyRules.length > 0 && (
                <div className="rule-group">
                  <h4>Proxy Rules:</h4>
                  <div className="rule-tags">
                    {proxyRules.map((rule, i) => (
                      <span key={i} className="rule-tag proxy">{rule}</span>
                    ))}
                  </div>
                </div>
              )}
              {directRules.length > 0 && (
                <div className="rule-group">
                  <h4>Direct Rules:</h4>
                  <div className="rule-tags">
                    {directRules.map((rule, i) => (
                      <span key={i} className="rule-tag direct">{rule}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 4: App Routing Manager */}
        <div className="step-section">
          <h2>Step 4: App Routing Manager</h2>
          <p className="hint">🟢 Green = VPN Enabled | ⚪ Grey = Bypass/Direct</p>
          <div className="app-grid">
            {Object.entries(appRouting).map(([app, route]) => (
              <button
                key={app}
                className={`app-btn ${route === 'proxy' ? 'proxy' : 'direct'}`}
                onClick={() => toggleAppRoute(app)}
              >
                {app}
              </button>
            ))}
          </div>
          <button className="btn-save-settings" onClick={saveAppRouting}>
            {appRoutingSaved ? <><FaCheck /> Saved!</> : <><FaSave /> Save Routing</>}
          </button>
        </div>
        </div>

        <div className="right-column">
        {/* Active Nodes List */}
        {activeNodes.length > 0 && (
          <div className="active-nodes">
            <div className="active-nodes-header">
              <h3>Active Nodes ({activeNodes.length})</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-export-outline" onClick={exportNodesAsText} title="Export raw URIs as text file">
                  <FaDownload /> Export
                </button>
                <button className="btn-export-outline" onClick={downloadV2BoxSub} title="Download V2Box subscription (with //profile headers)">
                  <FaDownload /> V2Box Sub
                </button>
                <button className="btn-delete-outline" onClick={() => setActiveNodes([])}>
                  <FaTrash /> Clear All
                </button>
              </div>
            </div>
            <div className="nodes-list">
              {activeNodes.map((node, index) => (
                <div key={index} className="node-item">
                  <span className="node-name">{node.name}</span>
                  <span className="node-type">{node.type.toUpperCase()}</span>
                  <span className="node-server">{node.server}:{node.port}</span>
                  <button
                    className="btn-delete"
                    onClick={() => removeNode(index)}
                    title="Remove"
                  >
                    <FaTrash />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Final Config */}
        <div className="step-section final-config">
          <h2>Step 5: Final Configuration</h2>
          <div className="filename-section">
            <div className="filename-row">
              <div className="filename-field">
                <label>Filename Prefix</label>
                <div className="filename-input-group">
                  <input
                    type="text"
                    className="filename-input"
                    value={filePrefix}
                    onChange={e => setFilePrefix(e.target.value)}
                    placeholder="vchannel-config"
                  />
                  <button className="btn-save-prefix" onClick={saveFilePrefix} title="Save prefix">
                    <FaSave />
                  </button>
                </div>
              </div>
              <span className="filename-dash">—</span>
              <div className="filename-field">
                <label>Filename Suffix</label>
                <input
                  type="text"
                  className="filename-input"
                  value={fileSuffix}
                  onChange={e => setFileSuffix(e.target.value)}
                  placeholder="username"
                />
              </div>
            </div>
            <div className="filename-meta-row">
              <label
                className="save-txt-checkbox-label"
                title="Also save a V2Box .txt subscription file when saving to server"
              >
                <input
                  type="checkbox"
                  checked={alsoSaveTxt}
                  onChange={(e) => setAlsoSaveTxt(e.target.checked)}
                />
                Save TXT File
              </label>
              <div className="filename-preview">
                <span className="filename-preview-label">File:</span>
                <span className="filename-preview-value">{getCombinedFilename()}</span>
              </div>
            </div>
          </div>
          <div className="config-actions">
            <button className="btn-primary" onClick={copyToClipboard}>
              {copied ? <><FaCheck /> Copied!</> : <><FaCopy /> Copy</>}
            </button>
            <button className="btn-success" onClick={saveToFile}>
              <FaSave /> Save File
            </button>
            <button
              className={`btn-server-save${serverSaveStatus === 'saved' ? ' btn-server-saved' : serverSaveStatus === 'error' ? ' btn-server-error' : ''}`}
              onClick={saveToServer}
              disabled={serverSaveStatus === 'saving'}
            >
              {serverSaveStatus === 'saving' ? <><FaServer /> Saving...</> :
               serverSaveStatus === 'saved' ? <><FaCheck /> Saved!</> :
               <><FaServer /> Save to Server</>}
            </button>
            {serverSaveMsg && (
              <span className={`server-save-msg ${serverSaveStatus === 'error' ? 'server-save-msg-error' : ''}`}>
                {serverSaveMsg}
              </span>
            )}
          </div>
          {subUrls && (
            <div className="sub-urls-panel">
              <div className="sub-url-row">
                <span className="sub-url-label" title="Base64 proxy URI list — use with V2Box / V2RayNG / any standard subscription client">📋 Sub URL:</span>
                <input type="text" className="sub-url-input" value={subUrls.base} readOnly onClick={e => e.target.select()} />
                <button className="btn-copy-url" onClick={() => navigator.clipboard.writeText(subUrls.base)} title="Copy — paste into V2Box or V2RayNG 'Add Subscription'"><FaCopy /></button>
              </div>
              <div className="sub-url-row">
                <span className="sub-url-label" title="Proxy-only sing-box JSON — use with V2Box or NekoBox native sing-box subscription">📦 Raw URL:</span>
                <input type="text" className="sub-url-input" value={subUrls.raw} readOnly onClick={e => e.target.select()} />
                <button className="btn-copy-url" onClick={() => navigator.clipboard.writeText(subUrls.raw)} title="Copy — paste into V2Box 'Add sing-box Subscription'"><FaCopy /></button>
              </div>
              <div className="sub-url-row">
                <span className="sub-url-label" title="Full V2Ray/Xray JSON config — use with V2RayNG 'import v2ray json from clipboard'">⚙️ V2Ray URL:</span>
                <input type="text" className="sub-url-input" value={subUrls.v2ray} readOnly onClick={e => e.target.select()} />
                <button className="btn-copy-url" onClick={() => navigator.clipboard.writeText(subUrls.v2ray)} title="Copy — fetch and import in V2RayNG 'import v2ray json from clipboard'"><FaCopy /></button>
              </div>
            </div>
          )}
          <textarea
            value={generatedJson}
            readOnly
            className="yaml-output"
          />
        </div>
        </div>
      </div>
    </div>
  );
};

export default JsonGeneratorPage;
