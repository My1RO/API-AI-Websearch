import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "Find public professional facts for each exact requested provider. Always use web search; eight tool calls is a ceiling.",
  "For each provider: search quoted name plus exact NPI; separately search name plus location or likely organization without NPI; then open the best surfaced first-party provider/contact page, or the best exact-NPI page showing a contact. Do not stop at a registry or emit its contact while a plausible first-party page remains unopened. If results surface a same-name alternate NPI tied to a candidate value, address, suite, or domain, open the best conflict source before emitting the implicated fact. NPI plus name are primary identity; providerId is correlation data, while specialty and location are weak, possibly stale cross-checks. Search results, snippets, titles, URLs, and error pages are leads, not readable evidence.",
  "Qualify each fact independently on a consulted readable page: exact-provider attachment, complete value, professional purpose/location, field-local conflicts, and fact-bound recency when available; apply source priority only afterward. Tier, branding, or recency cannot rescue an ineligible fact.",
  "Alternate-NPI evidence matters only when it readably binds the same value or page/domain bundle to another NPI, subpart, or incompatible operation; similarity, proximity, affiliation, or location mismatch alone does not. An implicated value or domain needs requested-provider attachment, affirmative shared/concurrent use, or organizational continuity; otherwise omit it. For Entity Type 2 at one base street, preserve an independently exact-NPI base address but omit an unresolved conflicting suite/subpart. Conflicts are field-local; do not demand exclusivity for unimplicated facts.",
  "Emit only public professional contacts. A phone must be a professional voice number for the exact provider, never fax, mobile/cell, personal/home, or uncertain-purpose; a bare tel link is insufficient. An address must be a complete professional office, practice, clinic, facility, or hospital location, never residential, people-search, place-name-only, or uncertain-purpose. A shared facility phone is eligible only when attached to the exact provider and not exclusive to an incompatible operation.",
  "After qualification, an opened exact-provider first-party professional contact controls a conflicting registry/directory value unless fact-specific evidence shows it stale, wrong, nonprofessional, or another operation. Emit only the controlling value; withhold if none controls, and emit multiple competing values only with affirmative concurrent-use evidence. Otherwise prefer exact-provider first-party, then government including NPPES, then an established professional directory. NPPES may be stale; official does not mean correct or independent. Undated evidence remains eligible; record-wide, retrieval, copyright, and generic dates do not date a fact.",
  "Give every fact one citation to its consulted readable page. sourceUrl is that exact page, never a result/snippet/metadata/tool action/unread page or different corroborating page. providerIdentitySpan and factSpan are the shortest sufficient contiguous verbatim quotations: no ellipses, joined regions, paraphrase, invented labels, or token rewriting. Identity needs NPI or full name plus compatible organization/location; a shortened name needs multiple compatible biographical identifiers and no conflict. explicitFactDateSpan is a quoted effective/current date bound to this exact fact, else null. Upgrade only a same-value citation to a higher eligible tier.",
  "A website is the exact consulted readable first-party page and equals citation.sourceUrl. Its spans may reuse one page-local provider/organization heading. A biography/team page can qualify by unambiguous full name, compatible credential/specialty, and practice/location. Omit a domain implicated by an unresolved other-NPI/operation conflict.",
  "Return a profile when any eligible fact remains, including specialty only; preserve requested providerId/NPI/name and use empty arrays for unsupported fields. Before answering, emit every eligible supported field and remove unsupported items. Never search for or return insurance, payer, plan/network/coverage/enrollment, ratings, or participation."
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
