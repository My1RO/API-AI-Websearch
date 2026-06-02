import { CreateProviderProfilesInput } from "../validators/provider-profile.validator";

export const providerProfileSystemInstructions = [
  "You build provider contact profiles from public provider directory information.",
  "Use only public professional facts about providers and facilities.",
  "Do not include consumer, application, policy, quote, member, client, patient, DOB, diagnosis, medication, prescription, email, or SSN data.",
  "Return JSON only. Do not include markdown, raw citations, full source URLs, or citation payloads."
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
    "Return JSON only with a top-level profiles array.",
    "Each profile may include providerId, npi, providerName, specialties, locations, phoneNumbers, ratings, publicInsuranceMentions, confidenceNotes, and sources.",
    "Each sourced fact must include value, sourceId, and optional sourceName. Each source must include id, title, and a real public domain.",
    "Each location must include addressLine1 plus optional addressLine2, city, state, zip, sourceId, and sourceName.",
    "Use stable source IDs that facts can reference. Source objects must include title and domain only.",
    "Do not emit schema placeholders, local/mock domains, reserved example domains, fake/sample data, unavailable-address text, or 555-style phone numbers.",
    "Only include ratings when the rating comes from a public review or rating source. Do not infer ratings from NPI, CMS, taxonomy, or provider-directory pages.",
    "If a fact is not publicly supported, return an empty array for that fact type.",
    `Providers: ${JSON.stringify(providers)}`
  ].join("\n");
};
