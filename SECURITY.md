# Security

UniCut is currently a local-use beta. The default launcher binds to
`127.0.0.1:7860`. It has no authentication, tenant isolation, or public-service
resource controls and is not intended to accept untrusted internet traffic.

Keep the server on localhost. Do not expose it through a public tunnel or change
the bind address to a public interface without implementing and reviewing the
necessary access and resource controls. Uploaded images and masks are held in
memory; the app is not a secure multi-user storage service.

Only process files you trust, keep dependencies updated, and review the licenses
and provenance of model weights before replacing them.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository if it is
enabled. Otherwise, open an issue asking for a private reporting channel without
posting exploit details or sensitive data. Include reproduction steps, affected
versions, and impact in the private report.

Security fixes are maintained on the default branch; there is no separate
long-term support release policy yet.
