export type ProviderProfileJobStatus = "queued" | "running" | "completed" | "failed" | "expired";

export interface ProviderProfileRequestItem {
  providerId?: string;
  npi?: string;
  name: string;
  specialty?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface ProviderSource {
  id: string;
  title: string;
  domain: string;
  url?: string;
}

export interface SourcedValue {
  value: string;
  sourceId: string;
  sourceName?: string;
}

export interface ProviderLocation {
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  sourceId: string;
  sourceName?: string;
}

export interface ProviderRating {
  value: string;
  scale?: string | null;
  sourceId: string;
  sourceName?: string;
}

export interface ProviderProfile {
  providerId?: string;
  npi?: string;
  providerName: string;
  specialties: SourcedValue[];
  locations: ProviderLocation[];
  phoneNumbers: SourcedValue[];
  ratings: ProviderRating[];
  publicInsuranceMentions: SourcedValue[];
  confidenceNotes?: string[];
  sources: ProviderSource[];
}

export interface ProviderProfileJob {
  requestId: string;
  status: ProviderProfileJobStatus;
  expiresAt: string;
  profiles?: ProviderProfile[];
  error?: string;
}
