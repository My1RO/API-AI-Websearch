import { createHash } from "node:crypto";

import { getDataSource } from "../db/data-source";
import { FeedbackInput, PhoneCallInput } from "../validators/provider-profile.validator";
import { HttpError } from "../errors/http-error";
import {
  safePublicUrl,
  sanitizePhoneNumberOrThrow,
  sanitizeStoredFactOrThrow
} from "./sanitizer.service";

export const sanitizeFeedbackFactValueOrThrow = (
  factType: FeedbackInput["factType"],
  value: string
): string => {
  if (factType === "phone") {
    return sanitizePhoneNumberOrThrow(value);
  }

  if (factType === "website") {
    const website = safePublicUrl(value);
    if (!website || website.length > 255) {
      throw new HttpError(400, "normalizedFactValue is not a safe public website.", "UNSAFE_FACT_VALUE");
    }
    return website;
  }

  return sanitizeStoredFactOrThrow(value, "normalizedFactValue");
};

const aggregationKey = (dimensions: string[]): string => {
  return createHash("sha256").update(JSON.stringify(dimensions)).digest("hex");
};

const utcDay = (): string => new Date().toISOString().slice(0, 10);

export const saveFeedback = async (input: FeedbackInput): Promise<void> => {
  const normalizedFactValue = sanitizeFeedbackFactValueOrThrow(input.factType, input.normalizedFactValue);
  const providerId = input.providerId?.slice(0, 191) || "";
  const providerNpi = input.providerNpi || "";
  const reasonCode = input.reasonCode || "accurate";
  const feedbackDay = utcDay();
  const dataSource = await getDataSource();
  const detailedKey = aggregationKey([
    input.brokerOrgId,
    input.submitterClass,
    providerNpi,
    providerId,
    input.factType,
    normalizedFactValue,
    input.validationStatus,
    reasonCode,
    feedbackDay
  ]);

  await dataSource.query(
    `INSERT INTO ai_provider_fact_feedback_counts
      (aggregation_key, broker_org_id, submitter_class, provider_npi, provider_id, fact_type, normalized_fact_value, validation_status, reason_code, feedback_day, feedback_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE feedback_count = feedback_count + 1`,
    [
      detailedKey,
      input.brokerOrgId,
      input.submitterClass,
      providerNpi,
      providerId,
      input.factType,
      normalizedFactValue,
      input.validationStatus,
      reasonCode,
      feedbackDay
    ]
  );

  const isPositive = input.validationStatus === "correct";
  const consensusKey = aggregationKey([
    input.brokerOrgId,
    providerNpi,
    providerId,
    input.factType,
    normalizedFactValue,
    feedbackDay
  ]);
  await dataSource.query(
    `INSERT INTO ai_provider_fact_consensus
      (aggregation_key, broker_org_id, provider_npi, provider_id, fact_type, normalized_fact_value, feedback_day, positive_count, negative_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       positive_count = positive_count + VALUES(positive_count),
       negative_count = negative_count + VALUES(negative_count)`,
    [
      consensusKey,
      input.brokerOrgId,
      providerNpi,
      providerId,
      input.factType,
      normalizedFactValue,
      feedbackDay,
      isPositive ? 1 : 0,
      isPositive ? 0 : 1
    ]
  );
};

export const savePhoneCall = async (input: PhoneCallInput): Promise<void> => {
  const normalizedPhone = sanitizePhoneNumberOrThrow(input.normalizedPhone);
  const providerId = input.providerId?.slice(0, 191) || "";
  const providerNpi = input.providerNpi || "";
  const clickDay = utcDay();
  const dataSource = await getDataSource();
  const phoneKey = aggregationKey([
    input.brokerOrgId,
    providerNpi,
    providerId,
    normalizedPhone,
    clickDay
  ]);

  await dataSource.query(
    `INSERT INTO ai_provider_phone_call_counts
      (aggregation_key, broker_org_id, provider_npi, provider_id, normalized_phone, click_day, click_count)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE click_count = click_count + 1`,
    [phoneKey, input.brokerOrgId, providerNpi, providerId, normalizedPhone, clickDay]
  );
};
