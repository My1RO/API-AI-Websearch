import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "Find public professional facts for each exact requested provider. Always use web search; eight tool calls is a ceiling.",
  "For each provider: search quoted name plus exact NPI; separately search name plus location or likely organization without NPI; then open the best surfaced first-party provider/contact page, or the best exact-NPI page showing a contact. Do not stop at a registry or emit its contact while a plausible first-party page remains unopened. For an organization, if any same-name alternate NPI surfaces, open its exact-NPI source before emitting a first-party contact or domain; if the first-party page matches that NPI's suite/contact bundle rather than the request, omit the bundle absent affirmative shared/concurrent use. NPI plus name are primary identity; providerId is correlation data, while specialty and location are weak, possibly stale cross-checks. Results, snippets, titles, URLs, and error pages are leads, not readable evidence.",
  "Qualify each fact independently on a consulted readable page: exact-provider attachment, complete value, professional purpose/location, field-local conflicts, and fact-bound recency when available; apply source priority only afterward. Tier, branding, or recency cannot rescue an ineligible fact.",
  "Alternate-NPI evidence matters only when it readably binds the same value or page/domain bundle to another NPI, subpart, or incompatible operation; similarity, proximity, affiliation, or location mismatch alone does not. An implicated value or domain needs requested-provider attachment, affirmative shared/concurrent use, or organizational continuity; otherwise omit it. For Entity Type 2 at one base street, preserve an independently exact-NPI base address but omit an unresolved conflicting suite/subpart. Conflicts are field-local; do not demand exclusivity for unimplicated facts.",
  "Emit only public professional contacts. A phone must be a professional voice number for the exact provider, never fax, mobile/cell, personal/home, or uncertain-purpose; a bare tel link is insufficient. An address must be a complete professional office, practice, clinic, facility, or hospital location, never residential, people-search, place-name-only, or uncertain-purpose. For an individual, a registry/directory practice-location label alone is insufficient only when the address has neither a suite/floor nor a named professional-premises indicator. Then search the exact address once for office/clinic/facility/professional-premises evidence; omit only if professional use remains unestablished. A shared facility phone is eligible only when attached to the exact provider and not exclusive to an incompatible operation.",
  "After qualification, when an opened exact-provider first-party page shows a professional contact, emit it and no conflicting government/registry/directory value. Withhold that first-party value only when its own page identifies it as stale, nonprofessional, or another operation; withhold if no source controls, and emit competing values only with affirmative concurrent use. Otherwise prefer exact-provider first-party, then government including NPPES, then an established professional directory. NPPES may be stale; official does not mean correct or independent. Undated evidence remains eligible. A page, profile, registry-record, facility-license, retrieval, copyright, or generic date does not date its phone/address unless it explicitly governs that exact value.",
  "Give every fact one citation to its consulted readable page. sourceUrl is that exact page, never a result/snippet/metadata/tool action/unread page or different corroborating page. providerIdentitySpan and factSpan are the shortest sufficient contiguous verbatim quotations: no ellipses, joined regions, paraphrase, invented labels, or token rewriting. Identity needs NPI or full name plus compatible organization/location; a shortened name needs multiple compatible biographical identifiers and no conflict. explicitFactDateSpan is a quoted effective/current date bound to this exact fact, else null. Upgrade only a same-value citation to a higher eligible tier.",
  "A website is the exact consulted readable first-party page and equals citation.sourceUrl. Its spans may reuse one page-local provider/organization heading. A biography/team page can qualify by unambiguous full name, compatible credential/specialty, and practice/location. Omit a domain implicated by an unresolved other-NPI/operation conflict.",
  "Return a profile when any eligible fact remains, including specialty only; preserve requested providerId/NPI/name and use empty arrays for unsupported fields. After opening, emit every eligible supported field, not a subset; return specialty-only only when the completed workflow finds no eligible phone, address, or website. Remove unsupported items. Never search for or return insurance, payer, plan/network/coverage/enrollment, ratings, or participation."
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
    "Find eligible public professional facts for these providers.",
    `Providers: ${JSON.stringify(providers)}`
  ].join("\n");
};
