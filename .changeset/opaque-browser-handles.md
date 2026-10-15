---
"visualguard": patch
---

Derive opaque session and OIDC correlation cookie handles with SHA-256 before browser storage, and retain only their separate lookup hashes server-side. Address PR #9's two CodeQL cleartext-cookie alerts without adding configuration or changing authentication/PKCE checks. Include regression coverage for hashed lookup keys and one-time callbacks; local checks were deferred at the user's request.
