"use strict";

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|referrer|tracking|source)$/i;

const canonicalExactSourceUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
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
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    throw new Error(`Unsafe evidence URL port: ${value}`);
  }
  return url.toString();
};

module.exports = { canonicalExactSourceUrl, canonicalProvenanceKey, assertFetchablePublicUrl };
