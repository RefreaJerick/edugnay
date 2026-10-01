function getFrontendOrigin(value = process.env.FRONTEND_ORIGIN) {
  const configuredOrigin = String(value || '').trim();
  try {
    const parsed = new URL(configuredOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== configuredOrigin) {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new Error('FRONTEND_ORIGIN must be one exact http(s) origin without a path or trailing slash.');
  }
}

function getTrustProxyHops(value = process.env.TRUST_PROXY_HOPS) {
  const configuredHops = String(value || '').trim();
  if (!configuredHops) return 0;
  const hops = Number(configuredHops);
  if (!Number.isSafeInteger(hops) || hops < 1) {
    throw new Error('TRUST_PROXY_HOPS must be a positive whole number when configured.');
  }
  return hops;
}

module.exports = { getFrontendOrigin, getTrustProxyHops };
