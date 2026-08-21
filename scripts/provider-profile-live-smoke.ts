import { AZURE_OPENAI_DEPLOYMENT } from "../src/config/provider-profile-model";
import { getAiRuntimeStatus } from "../src/config/runtime";
import { ProviderProfileResponsesClient } from "../src/services/ai-provider/responses-provider.client";

const liveSmokeEnabled = ["1", "true", "yes", "on"].includes((process.env.AI_LIVE_SMOKE || "").toLowerCase());

if (!liveSmokeEnabled) {
  throw new Error("Set AI_LIVE_SMOKE=true to run the live provider-profile smoke test.");
}

const started = Date.now();

new ProviderProfileResponsesClient()
  .searchProviderProfiles({
    lineOfCoverage: "Medical",
    providers: [
      {
        providerId: "1679525919",
        npi: "1679525919",
        name: "THE CLEVELAND CLINIC FOUNDATION",
        specialty: "General Acute Care Hospital",
        city: "Cleveland",
        state: "OH",
        zip: "44195"
      }
    ]
  })
  .then((profiles) => {
    const firstProfile = profiles[0];
    process.stdout.write(`${JSON.stringify({
      ok: true,
      elapsedMs: Date.now() - started,
      runtime: getAiRuntimeStatus(),
      model: AZURE_OPENAI_DEPLOYMENT,
      profileCount: profiles.length,
      firstProfile: firstProfile ? {
        hasProviderName: Boolean(firstProfile.providerName),
        locationCount: firstProfile.locations.length,
        phoneCount: firstProfile.phoneNumbers.length,
        ratingCount: firstProfile.ratings.length,
        publicInsuranceMentionCount: firstProfile.publicInsuranceMentions.length,
        sourceCount: firstProfile.sources.length
      } : null
    }, null, 2)}\n`);
  })
  .catch((error) => {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      elapsedMs: Date.now() - started,
      runtime: getAiRuntimeStatus(),
      model: AZURE_OPENAI_DEPLOYMENT,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Provider profile smoke failed."
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
