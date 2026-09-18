type PumpMetadataInput = {
  image: ArrayBuffer;
  imageMime: string;
  name: string;
  symbol: string;
  description: string;
  website: string | null;
  social: string | null;
};

export async function uploadPumpMetadata(input: PumpMetadataInput) {
  const extension = input.imageMime === "image/png" ? "png" : input.imageMime === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.append("file", new File([input.image], `${input.symbol.toLowerCase()}.${extension}`, { type: input.imageMime }));
  form.append("name", input.name);
  form.append("symbol", input.symbol);
  form.append("description", input.description);
  form.append("showName", "true");
  form.append("createdOn", "https://sportpad.fun");
  if (input.website) form.append("website", input.website);
  if (input.social) form.append("twitter", input.social);

  const response = await fetch("https://pump.fun/api/ipfs", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.error("pump_metadata_upload_failed", response.status);
    throw new Error("Pump metadata upload failed");
  }
  const result = await response.json() as { metadataUri?: unknown; uri?: unknown };
  const metadataUri = typeof result.metadataUri === "string"
    ? result.metadataUri
    : typeof result.uri === "string"
      ? result.uri
      : "";
  if (!/^https:\/\/[A-Za-z0-9.-]+\/[^\s]{1,170}$/.test(metadataUri) || metadataUri.length > 200) {
    throw new Error("Pump metadata response was invalid");
  }
  return metadataUri;
}
