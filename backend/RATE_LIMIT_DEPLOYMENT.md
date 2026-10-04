# API rate limits for deployment

- Ordinary API requests: 1,200 per signed-in user (or unauthenticated IP) per 15 minutes. A separate 30,000-request network ceiling protects the server. `/api/health` does not use either quota.
- Sign-in, password reset/change, registration, and QR scanning retain their stricter route-specific limits.
- Use one API process with the built-in in-memory rate-limit store. If hosting runs multiple API instances, configure a shared store before scaling out; otherwise each instance has independent counters.
- Set `TRUST_PROXY_HOPS` only after confirming the number of trusted reverse proxies in front of the API. Never trust arbitrary forwarded IP headers. Check the rate-limit headers from two clients behind the real proxy.
- Monitor 429 responses by route and confirm ordinary browsing does not reach the user or network limits. Review any repeated 429s before raising limits. Do not log passwords, session cookies, or student data.
- A 429 includes `Retry-After`; the frontend shows a wait/retry message. A 401 means the eight-hour session has expired, while 503 or a network failure means the service is unavailable.

Before the demo, open the Admin Users, teacher, student, and parent pages in multiple tabs and accounts. Leave them open through a 15-minute window and verify that normal navigation succeeds without restarting the API. Deliberately reach a sensitive-route limit in an isolated test environment and verify that it resets after its window.
