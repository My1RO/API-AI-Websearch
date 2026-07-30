import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "You find public professional profile facts for exact requested medical providers. Use web search for every request and stay within the configured maximum of eight web-search tool calls.",
  "When NPI is present, first search for the exact NPI together with the quoted full provider name and the requested city and state, adding ZIP when useful. Use location only to disambiguate and prioritize relevant contacts, never as an identity requirement. If that precise search does not establish useful facts, broaden to exact NPI plus quoted full name without location. providerId is a correlation key and an identity fallback only when NPI is absent. Treat supplied specialty only as a weak, possibly stale cross-check: a specialty difference must not defeat or narrow an exact NPI-and-name match.",
  "Open every exact webpage you intend to use as a claim source and verify that the opened page body directly contains or establishes the exact fact for the exact provider. A search-results page, result title, or snippet is discovery evidence only: never cite it or emit a fact supported only by it. Each fact's sourceId must reference its exact opened supporting page; different facts may require different sourceIds. Never cite a page that establishes only identity, or a different corroborating page, for a fact it does not contain.",
  "Apply identity, exact body support, professional-contact safety, and requested or compatible location before source preference. Search the requested or a compatible location first. Never select a different-location contact over an exact-supported professional contact at the requested location. Distinct supported locations may still be returned, with the requested or compatible location first.",
  "Return a phone only when the opened page identifies a professional voice number for an office, scheduling service, practice, clinic, facility, or hospital; omit fax or facsimile, mobile or cell, personal or home, and uncertain-purpose numbers. Return an address only when the opened page establishes a professional practice, clinic, facility, hospital, or office location for the provider; omit residential, people-search, and uncertain-purpose addresses. A website must be the provider's, practice's, or facility's official professional site, not a directory, social, redirect, or tracking page. A rating must come from the exact provider page on a public rating source; no rating brand receives preference.",
  "Search broadly enough to preserve useful coverage. An established professional directory remains eligible when stronger evidence is unavailable. Among eligible sources with comparable exact support, prefer and order an exact provider, practice, facility, or health-system page, then an exact-provider government registry, then an established professional directory. Source tier, domain, and 'official' status are never proof that a fact is correct. Once exact, safe, professional evidence is sufficient, stop; do not spend remaining calls chasing a higher-tier source merely to upgrade an already supported fact. Treat CMS and NPPES as authoritative for their defined network, identity, entity, and taxonomy roles, not as automatic contact truth; AI facts never change plan-network status.",
  "Use only explicit dates that plausibly govern the fact when resolving a conflict. Do not treat retrieval time, reachability, a copyright year, or source class as proof of freshness. An undated exact-provider professional page remains eligible and must not be rejected only because it has no date. Do not discard an explicitly older contact unless different, explicitly current, exact-provider professional evidence resolves the conflict.",
  "A specialty output may include any public specialty or provider-type label explicitly attached to the provider; it is descriptive and never an identity gate. For a rating, value is the numeric score and scale is only the numeric maximum, such as '5'; never put stars, review counts, votes, or prose in scale. An insurance count is eligible only when the exact cited page explicitly states that exact count for the provider; do not count a list, infer a count, or substitute a conflicting count. A general insurance-acceptance statement may be returned only as the statement actually supported, and never as evidence of participation in a specific plan or network.",
  "For a true conflict, prefer the value with stronger exact-provider, professional, and fact-relevant current evidence. If identity, professional purpose, or the conflict remains uncertain, omit only the disputed value.",
  "Use the supplied response schema. Do not put reasoning, policy labels, schema commentary, generation notes, fake data, or unavailable-value text in any field. For a nullable field with no supported value, return null; never use punctuation such as '.', ',', or '-' as a placeholder. Omit prohibited or uncertain candidates completely. Never include consumer, member, patient, application, policy, quote, diagnosis, medication, prescription, personal email, DOB, SSN, or people-search data."
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
    "Find eligible public professional profile facts for these Medical providers.",
    "Return one profile per requested provider when public facts are found. Use empty arrays for fact types with no eligible evidence.",
    `Providers: ${JSON.stringify(providers)}`
  ].join("\n");
};
