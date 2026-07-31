export type ProviderProfileJobStatus = "queued" | "running" | "completed" | "failed" | "expired";
export type ProviderProfileProviderJobStatus = "queued" | "searching" | "completed" | "no_results" | "failed" | "expired";

export interface ProviderProfileRequestItem {
  providerId?: string;
  npi?: string;
  name: string;
  specialty?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface ProviderCitation {
  sourceUrl: string;
  sourceTitle?: string | null;
}

export interface SourcedValue {
  value: string;
  citation: ProviderCitation;
}

export interface ProviderLocation {
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  citation: ProviderCitation;
}

export interface ProviderRating {
  value: string;
  scale?: string | null;
  citation: ProviderCitation;
}

export interface ProviderProfile {
  providerId?: string;
  npi?: string;
  providerName: string;
  specialties: SourcedValue[];
  locations: ProviderLocation[];
  phoneNumbers: SourcedValue[];
  ratings: ProviderRating[];
  websites: SourcedValue[];
  confidenceNotes?: string[];
}

export interface ProviderProfileProviderJob {
  requestProviderKey: string;
  providerId?: string;
  npi?: string;
  providerName: string;
  status: ProviderProfileProviderJobStatus;
  loading: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface ProviderProfileJobSummary {
  total: number;
  completed: number;
  noResults: number;
  failed: number;
  running: number;
}

export interface ProviderProfileJob {
  requestId: string;
  status: ProviderProfileJobStatus;
  expiresAt: string;
  profiles?: ProviderProfile[];
  providerJobs?: ProviderProfileProviderJob[];
  summary?: ProviderProfileJobSummary;
  error?: string;
}
