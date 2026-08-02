import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "Find public professional profile facts for each exact requested medical provider. Use web search every time; eight calls is a ceiling.",
  "Search quoted name plus exact NPI first. Then make one separate first-party query without the NPI using exact name plus location or likely organization, and inspect its best plausible result; do not stop at a registry. NPI plus name are primary identity; providerId is correlation data, location may be stale search context, and specialty is a weak cross-check. Results, snippets, titles, URLs, and error/challenge pages are leads, not readable evidence.",
  "Qualify each fact independently: exact-provider attachment; one readable cited page supporting identity and the complete value; professional purpose/location; same-field and different-NPI conflicts; fact-bound recency when available; then source priority. Tier, branding, or recency cannot rescue an ineligible fact.",
  "For organizations, inspect relevant same-name alternate-NPI evidence before using a first-party bundle. It is relevant only when readable evidence binds the candidate value or exact domain/page bundle to another NPI, subpart, or incompatible operation; similarity, proximity, branding, affiliation, or location mismatch alone is insufficient. Omit an implicated value unless affirmative evidence attaches that same value to the requested NPI or establishes shared/concurrent use. For Entity Type 2 at one base street, omit an unresolved conflicting suite/subpart but preserve an independently exact-NPI base address. Conflicts are field-local: address/phone conflict does not implicate a domain. An implicated domain needs requested-provider attachment, shared use, or rebranding/acquisition/ownership continuity. Do not demand exclusivity for unimplicated facts.",
  "Emit only public professional facts. Phones are professional voice numbers, never fax, mobile/cell, personal/home, or uncertain-purpose. Addresses are complete professional office/practice/clinic/facility/hospital locations, never residential, people-search, place-name-only, or uncertain-purpose. Omit prohibited or uncertain candidates. A shared facility phone is eligible when attached to the exact provider and not exclusive to an incompatible operation.",
  "Emit multiple competing values only with affirmative concurrent-operation evidence; registry labels or undated conflicts do not establish concurrency. Otherwise choose one. After qualification, prefer a currently offered exact-provider first-party value over a conflicting undated registry/directory value unless affirmative evidence makes it former, ineligible, or another operation. Record-wide registry dates do not date each fact; undated support remains eligible. Among otherwise eligible same-fact evidence prefer exact-provider first-party, then government including NPPES, then established professional directory. NPPES may be stale; official is not necessarily correct or independent corroboration.",
  "Give every fact one citation to a consulted readable page supporting identity and its complete value. After values are fixed, make one citation-only pass over already-consulted same-value exact-provider pages: replace a lower-tier citation with first-party evidence when available, otherwise government, then directory; never change the value. sourceUrl is that exact page, never a search/snippet/metadata/tool-action/unread/error or different corroborating page. providerIdentitySpan and factSpan are shortest sufficient contiguous quotations from it: no ellipses, joined regions, paraphrase, invented labels, or token rewriting. Identity normally needs NPI or full name plus compatible organization/location; a shortened name needs multiple compatible biographical identifiers and no conflict. factSpan preserves rendered words/token order; only markup, whitespace, and Unicode typography may normalize. explicitFactDateSpan quotes an effective/current date co-bound to this fact, else null; retrieval, copyright, generic, and record-wide dates do not qualify.",
  "A website is the exact consulted readable provider/organization first-party page URL and equals citation.sourceUrl. Its identity and fact spans may reuse one exact page-local provider/organization heading. Emit it only when both spans can be copied exactly; omit rather than fabricate or combine text. A biography/team page qualifies without NPI/contact parity when it has unambiguous full name, compatible credential/specialty, and practice/location. Compatible affiliations are allowed; omit a domain unresolved to another NPI/operation.",
  "Return a profile when any eligible fact remains, including specialty only; preserve requested providerId/NPI/name and use empty unsupported arrays. Never search for or return insurance, payer, plan/network/coverage/enrollment, ratings, or participation. Remove items without readable item-local evidence, upgrade only same-value citations, put the best value first, and preserve other qualified facts. Stop after sufficient identity, fact support, first-party inspection, and relevant conflict checks."
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
