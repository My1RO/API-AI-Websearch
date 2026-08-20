"use strict";

const dns = require("node:dns");
const net = require("node:net");

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|referrer|tracking|source)$/i;

const isNonPublicIpv4 = (hostname) => {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 192 && second === 88 && third === 99)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
};

const parseIpv6Groups = (hostname) => {
  let address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!address || address.includes("%")) return null;
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    const dotted = address.slice(separator + 1);
    if (separator < 0 || net.isIP(dotted) !== 4) return null;
    const octets = dotted.split(".").map(Number);
    address = `${address.slice(0, separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length >= 8) return null;
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    .map((group) => Number.parseInt(group, 16));
  return groups.length === 8 ? groups : null;
};

const ipv6Value = (groups) => groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
const ipv6Prefix = (groups, bits) => ipv6Value(groups) >> BigInt(128 - bits);
const ipv6InPrefix = (groups, prefix, bits) =>
  ipv6Prefix(groups, bits) === ipv6Prefix(parseIpv6Groups(prefix), bits);

const isNonPublicIpv6 = (hostname) => {
  const groups = parseIpv6Groups(hostname);
  if (!groups) return true;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mappedIpv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
    return isNonPublicIpv4(mappedIpv4);
  }
  return [
    ["::", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3ffe::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8]
  ].some(([prefix, bits]) => ipv6InPrefix(groups, prefix, bits));
};

const isPublicIpAddress = (address) => {
  const normalized = String(address || "").replace(/^\[|\]$/g, "");
  const type = net.isIP(normalized);
  if (type === 4) return !isNonPublicIpv4(normalized);
  if (type === 6) return !isNonPublicIpv6(normalized);
  return false;
};

const isPublicHostname = (hostname) => {
  const normalized = String(hostname || "").replace(/\.$/, "").toLowerCase();
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")
    || normalized.endsWith(".local") || normalized.endsWith(".internal")
    || normalized.endsWith(".home.arpa")) return false;
  const addressType = net.isIP(normalized.replace(/^\[|\]$/g, ""));
  if (addressType) return isPublicIpAddress(normalized);
  return true;
};

const nonPublicResolutionError = (hostname, addresses) => {
  const error = new Error(`Non-public DNS resolution for evidence host ${hostname}: ${addresses.join(",")}`);
  error.code = "ERR_EVIDENCE_NON_PUBLIC_DNS";
  return error;
};

const createPublicLookup = (lookupImpl = dns.lookup) => (hostname, options, callback) => {
  const requested = options && typeof options === "object" ? options : {};
  lookupImpl(hostname, { family: requested.family, hints: requested.hints, all: true, verbatim: true },
    (error, answers) => {
      if (error) return callback(error);
      const addresses = Array.isArray(answers) ? answers : [];
      if (!addresses.length || addresses.some((answer) => !isPublicIpAddress(answer.address))) {
        return callback(nonPublicResolutionError(hostname, addresses.map((answer) => answer.address)));
      }
      if (requested.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
};

const canonicalExactSourceUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    if (!isPublicHostname(url.hostname)) return undefined;
    if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return undefined;
  }
};

const canonicalProvenanceKey = (value) => {
  const exact = canonicalExactSourceUrl(value);
  if (!exact) return undefined;
  const url = new URL(exact);
  if (url.hostname === "npiregistry.cms.hhs.gov") {
    const providerViewNpi = url.pathname.match(/^\/provider-view\/(\d{10})\/?$/)?.[1];
    const apiNpi = /^\/api\/?$/.test(url.pathname) && /^\d{10}$/.test(url.searchParams.get("number") || "")
      ? url.searchParams.get("number") : undefined;
    if (providerViewNpi || apiNpi) return `nppes:${providerViewNpi || apiNpi}`;
  }
  return exact;
};

const assertFetchablePublicUrl = (value) => {
  const url = new URL(String(value || "").trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`Unsafe evidence URL: ${value}`);
  if (!isPublicHostname(url.hostname)) throw new Error(`Non-public evidence URL: ${value}`);
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    throw new Error(`Unsafe evidence URL port: ${value}`);
  }
  return url.toString();
};

module.exports = {
  canonicalExactSourceUrl,
  canonicalProvenanceKey,
  assertFetchablePublicUrl,
  createPublicLookup,
  isPublicHostname,
  isPublicIpAddress
};
