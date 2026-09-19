export type PasskeyOptionsEnvelope = {
  challenge_id: string;
  public_key: Record<string, unknown>;
};

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type JsonDescriptor = { id: string; type?: PublicKeyCredentialType; transports?: AuthenticatorTransport[] };
type JsonCreationOptions = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: JsonDescriptor[];
};
type JsonRequestOptions = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & {
  challenge: string;
  allowCredentials?: JsonDescriptor[];
};

function creationOptions(input: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const source = input as unknown as JsonCreationOptions;
  return {
    ...source,
    challenge: decodeBase64Url(source.challenge),
    user: { ...source.user, id: decodeBase64Url(source.user.id) },
    excludeCredentials: source.excludeCredentials?.map((item) => ({
      ...item,
      id: decodeBase64Url(item.id),
      type: item.type ?? "public-key",
    })),
  };
}

function requestOptions(input: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const source = input as unknown as JsonRequestOptions;
  return {
    ...source,
    challenge: decodeBase64Url(source.challenge),
    allowCredentials: source.allowCredentials?.map((item) => ({
      ...item,
      id: decodeBase64Url(item.id),
      type: item.type ?? "public-key",
    })),
  };
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && Boolean(navigator.credentials);
}

export async function conditionalPasskeysSupported(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const constructor = window.PublicKeyCredential as typeof PublicKeyCredential & {
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  if (!constructor.isConditionalMediationAvailable) return false;
  try {
    return await constructor.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

export async function createPasskeyCredential(publicKeyJson: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!passkeysSupported()) throw new Error("Passkeys are not supported by this browser or device.");
  const credential = await navigator.credentials.create({ publicKey: creationOptions(publicKeyJson) });
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse)) {
    throw new Error("The browser did not return a valid passkey credential.");
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      attestationObject: encodeBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

export async function getPasskeyCredential(
  publicKeyJson: Record<string, unknown>,
  options: { conditional?: boolean; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  if (!passkeysSupported()) throw new Error("Passkeys are not supported by this browser or device.");
  const request: CredentialRequestOptions = {
    publicKey: requestOptions(publicKeyJson),
    signal: options.signal,
  };
  if (options.conditional) {
    (request as CredentialRequestOptions & { mediation: CredentialMediationRequirement }).mediation = "conditional";
  }
  const credential = await navigator.credentials.get(request);
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("The browser did not return a valid passkey assertion.");
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(response.authenticatorData),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    },
  };
}
