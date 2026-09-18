export type ProviderDetail =
  | "operational"
  | "not_configured"
  | "timeout"
  | "authentication_failed"
  | "rate_limited"
  | "upstream_unavailable"
  | "invalid_response"
  | "network_error";

export type ProviderCanaryStatus = {
  configured: boolean;
  healthy: boolean;
  checkedAt: string;
  detail: ProviderDetail;
};

export type ProviderCredentials = {
  heliusApiKey?: string;
  jupiterApiKey?: string;
};

export type CanaryOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
};
