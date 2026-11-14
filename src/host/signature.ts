// The signer's constants (ADR 0032, ADR 0033): what an image of this repository is called, the
// verifier a host runs, and the one identity a signature must carry. A leaf with no imports:
// the release's scripts (which run with no `bun install`) and the host's tool both read it.

export const IMAGE = "ghcr.io/wizardingcode-io/wizardingcode-mem";
/** cosign's version: what distribute.yml installs, and the release COSIGN_IMAGE is. */
export const COSIGN_VERSION = "v3.1.4";
/** cosign's own image at that version, by its index digest: a host verifies with it and installs nothing. */
export const COSIGN_IMAGE =
  "ghcr.io/sigstore/cosign/cosign@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d";
/**
 * What a signature made by a job of distribute.yml in a run on main carries. It is a contract
 * with every host that verifies: a rename of the workflow file or of the default branch makes
 * every host refuse every new image.
 */
export const SIGNER_IDENTITY =
  "https://github.com/WizardingCode-io/wizardingcode-mem/.github/workflows/distribute.yml@refs/heads/main";
export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** cosign's arguments to check that `reference` was signed by distribute.yml at main: the one form, here and in the runbook. */
export function verifyArgs(reference: string): string[] {
  return [
    "verify",
    reference,
    "--certificate-identity",
    SIGNER_IDENTITY,
    "--certificate-oidc-issuer",
    OIDC_ISSUER,
  ];
}
