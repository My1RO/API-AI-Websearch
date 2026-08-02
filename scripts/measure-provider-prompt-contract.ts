import { zodTextFormat } from "openai/helpers/zod";

import { buildProviderProfilePrompt, providerProfileSystemInstructions } from "../src/services/prompt-builder.service";
import { providerProfileStructuredOutputSchema } from "../src/validators/provider-profile.validator";

const format = zodTextFormat(providerProfileStructuredOutputSchema, "provider_profiles");
const userPrompt = buildProviderProfilePrompt({
  lineOfCoverage: "Medical",
  providers: [{
    providerId: "<providerId>",
    npi: "1234567890",
    name: "<name>",
    specialty: "<specialty>",
    city: "<city>",
    state: "NY",
    zip: "12345"
  }]
});
const schema = JSON.stringify(format.schema);
const sections = {
  instructions: providerProfileSystemInstructions,
  schema,
  userPrompt
};
const metrics = Object.fromEntries(Object.entries(sections).map(([name, value]) => [name, {
  characters: value.length,
  utf8Bytes: Buffer.byteLength(value),
  words: value.trim().split(/\s+/).filter(Boolean).length
}]));
const totalCharacters = Object.values(sections).reduce((sum, value) => sum + value.length, 0);
const totalUtf8Bytes = Object.values(sections).reduce((sum, value) => sum + Buffer.byteLength(value), 0);

process.stdout.write(`${JSON.stringify({ metrics, totalCharacters, totalUtf8Bytes }, null, 2)}\n`);
