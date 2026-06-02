import { getDataSource } from "../db/data-source";
import { FeedbackInput, PhoneCallInput } from "../validators/provider-profile.validator";
import { sanitizePhoneNumberOrThrow, sanitizeStoredFactOrThrow } from "./sanitizer.service";

const likelyPhiPatterns = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b(member|client|patient|diagnosis|diagnosed|medication|prescription|ssn|dob)\b/i,
  /@/
];

export const assertFeedbackNoteIsSafe = (note?: string): void => {
  if (!note) {
    return;
  }

  if (likelyPhiPatterns.some((pattern) => pattern.test(note))) {
    throw new Error("Feedback note appears to contain client or PHI data and was rejected.");
  }
};

export const saveFeedback = async (input: FeedbackInput): Promise<void> => {
  assertFeedbackNoteIsSafe(input.optionalNote);
  const normalizedFactValue = sanitizeStoredFactOrThrow(input.normalizedFactValue, "normalizedFactValue");
  const providerId = input.providerId?.slice(0, 191) || null;
  const consensusProviderNpi = input.providerNpi || "";
  const consensusProviderId = providerId || "";
  const dataSource = await getDataSource();

  await dataSource.query(
    `INSERT INTO ai_provider_fact_feedback
      (broker_org_id, provider_npi, provider_id, fact_type, normalized_fact_value, validation_status, reason_code)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.brokerOrgId,
      input.providerNpi || null,
      providerId,
      input.factType,
      normalizedFactValue,
      input.validationStatus,
      input.reasonCode || null
    ]
  );

  const isPositive = ["useful", "correct"].includes(input.validationStatus);
  await dataSource.query(
    `INSERT INTO ai_provider_fact_consensus
      (broker_org_id, provider_npi, provider_id, fact_type, normalized_fact_value, positive_count, negative_count, last_validated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       positive_count = positive_count + VALUES(positive_count),
       negative_count = negative_count + VALUES(negative_count),
       last_validated_at = NOW(),
       updated_at = NOW()`,
    [
      input.brokerOrgId,
      consensusProviderNpi,
      consensusProviderId,
      input.factType,
      normalizedFactValue,
      isPositive ? 1 : 0,
      isPositive ? 0 : 1
    ]
  );
};

export const savePhoneCall = async (input: PhoneCallInput): Promise<void> => {
  const normalizedPhone = sanitizePhoneNumberOrThrow(input.normalizedPhone);
  const providerId = input.providerId?.slice(0, 191) || null;
  const dataSource = await getDataSource();

  await dataSource.query(
    `INSERT INTO ai_provider_phone_call_events
      (broker_org_id, provider_npi, provider_id, normalized_phone)
     VALUES (?, ?, ?, ?)`,
    [input.brokerOrgId, input.providerNpi || null, providerId, normalizedPhone]
  );
};
