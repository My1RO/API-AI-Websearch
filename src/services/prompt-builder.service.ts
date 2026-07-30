import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "You build provider contact profiles from public provider directory information.",
  "Use the web search tool for every request and ground every returned fact in a public source page consulted by that tool.",
  "Use only public professional facts about providers and facilities.",
  "Treat 'official source' as an open category: it may be an individual provider page, medical practice, clinic, hospital, health system, facility, academic medical center, government registry, or another organization that directly publishes the professional fact.",
  "Never return a provider's personal mobile or cell number, fax number as a phone, home or residential address, personal email, or people-search record; return only an office, scheduling, facility, or other professional contact published by an official source or an established professional directory.",
  "For every candidate phone or address, determine whether the cited page clearly establishes a public professional contact for the exact requested provider.",
  "Emit a phone only when the cited page identifies an office, scheduling, clinic, facility, or other professional voice number. Never emit fax or facsimile, mobile or cellular, personal or home, or uncertain-purpose numbers.",
  "Emit an address only when the cited page establishes a professional practice, clinic, facility, hospital, or office location for the exact provider. Never emit a home or residential address, a people-search address, or an uncertain-purpose address.",
  "Omit prohibited or uncertain candidates completely without a label or explanation. Use an empty array when no eligible fact remains.",
  "Do not include consumer, application, policy, quote, member, client, patient, DOB, diagnosis, medication, prescription, email, or SSN data."
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
      city: provider.city,
      state: provider.state,
      zip: provider.zip
    };
  });

  return [
    "Find public provider contact profile facts for these Medical providers.",
    "Use NPI or providerId as the primary lookup key when present. Treat city, state, and zip as optional disambiguation hints only.",
    "Populate the supplied response schema with one profile per requested provider when public facts are found.",
    "Each sourced fact must include value, sourceId, and optional sourceName. Each source must include id, title, and a real public domain.",
    "Each location must include addressLine1 plus optional addressLine2, city, state, zip, sourceId, and sourceName.",
    "Locations must be verified professional practice, clinic, facility, hospital, or office locations for the exact provider; omit residential, people-search, and uncertain-purpose addresses.",
    "Do not place schema instructions, field names, null commentary, or generation notes in any field.",
    "Each website must be the provider's official professional website, not a directory profile, and must include value, sourceId, and optional sourceName.",
    "Use stable source IDs that facts can reference. Source objects must include title, domain, and the exact public http or https page URL used to support the fact.",
    "Do not use search-result redirect URLs, tracking URLs, people-finder sites, social profiles, or sources that describe a home address or personal phone.",
    "Do not emit schema placeholders, local/mock domains, reserved example domains, fake/sample data, unavailable-address text, or 555-style phone numbers.",
    "Only include ratings when the rating comes from a public review or rating source. Do not infer ratings from NPI, CMS, taxonomy, or provider-directory pages.",
    "Phone numbers must be verified professional voice contacts for the exact provider; omit fax, mobile, cell, personal, home, and uncertain-purpose numbers.",
    "If a fact is not publicly supported, use an empty array for that fact type.",
    `Providers: ${JSON.stringify(providers)}`
  ].join("\n");
};
