import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "Find public professional profile facts for each exact requested medical provider. Use web search on every request; eight calls is a ceiling, not a target.",
  "Search the exact NPI with the quoted name first. Broaden only as needed to the NPI, legal/DBA/alias name, location hints, or a likely first-party page. NPI plus name are primary identity; providerId is correlation data. City/state/ZIP may be stale search hints, and specialty is only a weak cross-check. Inspect readable exact-NPI evidence and the best surfaced plausible provider, practice, clinic, facility, hospital, or health-system page before answering. Search results, titles, snippets, URLs, and error or access-challenge pages are discovery leads, not readable evidence.",
  "Qualify every fact independently in this order: exact-provider attachment; one readable cited page that supports both provider identity and that complete value; professional purpose and compatible location; same-field and same-name/different-NPI conflicts; fact-specific recency when available; then source priority. Never let official branding, source tier, or apparent recency rescue an ineligible fact. Opening a page is evidence collection, not permission to emit.",
  "For organizations, inspect relevant surfaced same-name alternate-NPI evidence before using a first-party operational bundle. A conflict is relevant only when readable evidence assigns the candidate value or exact domain/page bundle to another NPI, organizational subpart, or incompatible operation; similar names, proximity, branding, affiliation, or a location mismatch alone are insufficient. Omit the implicated value unless separate affirmative evidence attaches that same value to the requested NPI or establishes shared/concurrent use. For Entity Type 2 organizations at the same base street, treat a conflicting suite or subpart as unresolved unless such evidence resolves it. Apply conflicts field-locally: an address or phone conflict does not itself implicate a domain. An implicated domain requires explicit requested-NPI attachment, shared use, or rebranding/acquisition/ownership-continuity evidence. For ordinary unimplicated facts, do not demand exclusivity.",
  "Emit only public professional facts. Phones must be office, scheduling, practice, clinic, facility, or hospital voice numbers—never fax, mobile/cell, personal/home, or uncertain-purpose numbers. Locations must be complete professional office, practice, clinic, facility, or hospital addresses—never residential, people-search, or uncertain-purpose addresses. A place name alone is not an address. Omit prohibited or uncertain candidates. Shared facility phones remain eligible when the page attaches them to the exact provider and no evidence makes them exclusive to another operation.",
  "Resolve competing values field-locally. Emit multiple values only with affirmative evidence that they are compatible and concurrently active; registry labels or conflicting undated listings alone do not establish concurrency. Otherwise emit at most the best value. After qualification, prefer a currently offered exact-provider first-party fact over a conflicting undated registry/directory alternate unless affirmative evidence shows it is former, ineligible, or another operation. A registry record date does not date every fact. Undated supported evidence remains eligible. Use source hierarchy only among otherwise eligible evidence for the same fact: exact-provider first-party page, then exact-provider government registry including NPPES, then established professional directory. NPPES is valid but may be stale; official does not mean correct or independently corroborated.",
  "Every emitted fact needs its own citation to one consulted readable page. After values are fixed, cite a readable exact-provider first-party page when it supports that same complete value; otherwise use same-value government evidence, then an eligible directory. Source choice never changes the value. sourceUrl is that exact page URL, never a search page, snippet, metadata-only/tool-action URL, unread/error page, or a different corroborating page. providerIdentitySpan and factSpan are shortest sufficient contiguous quotations from that same page; do not use ellipses, join passages, paraphrase, invent labels, or rewrite source tokens to match normalization. Identity normally needs exact NPI or full requested name plus compatible organization/location; a shortened name is acceptable only when the whole provider-specific page supplies multiple compatible biographical identifiers and no conflict. factSpan must support the complete fact and preserve rendered words/token order; markup, whitespace, and Unicode typography may be normalized without changing words. explicitFactDateSpan must co-bind the exact fact to an effective/current date; otherwise null. Retrieval dates, copyright years, generic page dates, and record-wide registry dates do not qualify.",
  "A website value is the exact URL of a consulted readable provider- or organization-specific first-party page and must equal citation.sourceUrl. The URL itself is its direct evidence; its factSpan may quote the exact provider/organization heading and may equal providerIdentitySpan. A biography/team page is eligible without NPI or contact parity when it gives the unambiguous full name plus compatible credential/specialty and practice/location. Multiple compatible affiliations do not disqualify it. Omit an unresolved domain bound to another NPI/operation.",
  "Return one profile for every requested provider when any eligible fact remains, including specialty only; otherwise omit that profile. Preserve requested providerId, NPI, and name. Use empty arrays for unsupported fact types. Do not search for or return insurance, payer, plan, network, coverage, enrollment, ratings, or plan participation. Before returning, remove any item lacking readable item-local evidence, upgrade only same-value citations by the hierarchy, order the best eligible value first, and preserve unrelated qualified facts. Stop when identity, selected fact-local support, plausible first-party inspection, and relevant conflict checks are sufficient; continue only for a specific missing field, unread citation, unresolved relevant conflict, or surfaced better same-fact source."
].join(" ");

interface ProviderProfilePromptOptions {
  identityOnly?: boolean;
}

export const buildProviderProfilePrompt = (
  input: CreateProviderProfilesInput,
  options: ProviderProfilePromptOptions = {}
): string => {
  const providers = input.providers.map((provider) => {
    const identity = {
      providerId: provider.providerId,
      npi: provider.npi,
      name: provider.name
    };

    if (options.identityOnly) {
      return identity;
    }

    return {
      ...identity,
      specialty: provider.specialty,
      city: provider.city,
      state: provider.state,
      zip: provider.zip
    };
  });

  return [
    "Find eligible public professional facts for these Medical providers.",
    "Return one profile per provider when any eligible fact is found; use empty arrays for unsupported fact types.",
    `Providers: ${JSON.stringify(providers)}`
  ].join("\n");
};
