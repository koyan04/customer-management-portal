/**
 * IP Geolocation Helper
 * Fetches location data from IP address using multiple free services
 */

const axios = require('axios');

/**
 * Get geolocation data from IP address
 * Uses multiple free services with fallback
 * @param {string} ip - IP address to lookup
 * @returns {Promise<{city: string|null, country: string|null, location: string|null}>}
 */
async function getLocationFromIP(ip) {
  // Skip private/local IPs
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') || ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') || ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') || ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') || ip.startsWith('172.31.')) {
    return { city: null, country: null, location: null };
  }

  // Clean IP (remove port, IPv6 prefix, etc.)
  let cleanIP = ip.split(',')[0].trim(); // x-forwarded-for can be comma-separated
  cleanIP = cleanIP.replace(/^::ffff:/, ''); // Remove IPv6-mapped IPv4 prefix
  cleanIP = cleanIP.split(':')[0]; // Remove port if present

  const result = { city: null, country: null, location: null };

  // Try multiple services in order
  const services = [
    // Service 1: ip-api.com (free, no key required, 45 req/min limit)
    async () => {
      try {
        const response = await axios.get(`http://ip-api.com/json/${cleanIP}?fields=status,message,country,city`, {
          timeout: 3000,
          headers: { 'User-Agent': 'Customer-Management-Portal/1.0' }
        });
        if (response.data && response.data.status === 'success') {
          return {
            city: response.data.city || null,
            country: response.data.country || null,
            location: [response.data.city, response.data.country].filter(Boolean).join(', ') || null
          };
        }
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.warn('[geo] ip-api.com failed:', e.message);
      }
      return null;
    },

    // Service 2: ipapi.co (free, 1000 req/day, no key required)
    async () => {
      try {
        const response = await axios.get(`https://ipapi.co/${cleanIP}/json/`, {
          timeout: 3000,
          headers: { 'User-Agent': 'Customer-Management-Portal/1.0' }
        });
        if (response.data && !response.data.error) {
          return {
            city: response.data.city || null,
            country: response.data.country_name || null,
            location: [response.data.city, response.data.country_name].filter(Boolean).join(', ') || null
          };
        }
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.warn('[geo] ipapi.co failed:', e.message);
      }
      return null;
    },

    // Service 3: freegeoip.app (free, no key required)
    async () => {
      try {
        const response = await axios.get(`https://freegeoip.app/json/${cleanIP}`, {
          timeout: 3000,
          headers: { 'User-Agent': 'Customer-Management-Portal/1.0' }
        });
        if (response.data) {
          return {
            city: response.data.city || null,
            country: response.data.country_name || null,
            location: [response.data.city, response.data.country_name].filter(Boolean).join(', ') || null
          };
        }
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.warn('[geo] freegeoip.app failed:', e.message);
      }
      return null;
    }
  ];

  // Try each service until one succeeds
  for (const service of services) {
    try {
      const data = await service();
      if (data && (data.city || data.country)) {
        return data;
      }
    } catch (e) {
      // Continue to next service
    }
  }

  return result;
}

module.exports = { getLocationFromIP };
