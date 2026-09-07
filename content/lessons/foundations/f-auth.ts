import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-auth',
  title: 'Sessions, JWT, OAuth2 and OIDC',
  summary:
    'Statelessness buys scale and costs revocation, and almost every authentication design argument is really an argument about which of those two you need more.',
  phase: 'foundations',
  module: 'apis',
  position: 12,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['authentication', 'authorization', 'sessions', 'jwt', 'oauth', 'revocation'],
  prerequisites: ['f-tls-https', 'f-api-errors'],
  resources: [
    {
      key: 'owasp-session-cheatsheet',
      tier: 'must',
      note: 'The concrete rules for session cookies: attributes, rotation on privilege change, and idle versus absolute timeouts. Short, specific, and the source of most real fixes.',
    },
    {
      key: 'rfc-8725-jwt-bcp',
      tier: 'must',
      note: 'Read this before implementing anything with JWTs. Every entry exists because a real system was compromised by omitting it — particularly always specifying the expected algorithm rather than trusting the header.',
    },
    {
      key: 'oidc-core',
      tier: 'must',
      note: 'Sections 1-3 for the distinction this lesson turns on: OAuth2 delegates authorisation, OIDC adds authentication. Conflating them is the most common design error here.',
    },
    {
      key: 'rfc-6749-oauth2',
      tier: 'good',
      note: 'The grant types and what each is for. Read it to understand why the implicit grant existed and why it is no longer recommended.',
    },
    {
      key: 'rfc-7519-jwt',
      tier: 'good',
      note: 'The token format itself. Worth reading once so that "a JWT is a signed JSON blob with three base64 segments" stops being abstract.',
    },
    {
      key: 'owasp-auth-cheatsheet',
      tier: 'advanced',
      note: 'Credential handling, password storage and account recovery. Adjacent to this lesson and the place most real breaches actually occur.',
    },
  ],

  intuition: {
    body: `Three questions that get confused constantly, and separating them resolves most authentication arguments:

**Who are you?** Authentication. Proving identity — a password, a passkey, a token from an identity provider.

**What are you allowed to do?** Authorisation. A different question with a different answer, and it changes far more often than identity does.

**How do I avoid asking again on every request?** Session management. Almost all the design work lives here.

The third question has exactly two shapes, and everything else is a variation:

**Reference tokens.** Give the client a random, meaningless identifier. The server keeps the real state — who this is, what they may do, whether it is still valid. Every request costs a lookup, and revocation is a delete.

**Self-contained tokens.** Give the client a signed document *containing* the claims. The server verifies the signature and reads the claims with no lookup. Every request is stateless, and **you cannot take it back** — a signed token stays valid until it expires, because nothing consults you.

That trade is the whole lesson. Statelessness buys horizontal scale and costs revocation. Server state costs a lookup and buys instant control.

The mistake that follows from missing this: treating JWTs as strictly better because they are stateless, and then discovering that logging out does not log anyone out, that a compromised token works until expiry, and that a permission change takes fifteen minutes to apply. Those are not implementation bugs. They are the design, working as specified.`,
    analogyLimit:
      'The ticket-versus-wristband picture is close: a ticket stub the venue can look up and cancel, a wristband nobody can revoke once printed. Where it breaks is that a wristband is at least physically unique, whereas a copied token is indistinguishable from the original — so token theft has no analogue in the physical version, and it is the failure mode that matters most.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team uses stateless JWTs with a 1-hour expiry. Security reports a compromised token and asks for the user to be locked out immediately. What can the team actually do, and what does each option cost?',
      answer: `**With a purely stateless design: nothing that is both immediate and cheap.** The four available moves, in ascending order of collateral damage:

**1. Wait for expiry.** Up to 60 minutes of continued access. Free, and frequently unacceptable — that is a long time inside a system.

**2. Rotate the signing key.** Every token signed with the old key becomes invalid, so the compromised token dies instantly. It also logs out **every user**, and if the key is rotated during an incident that is thousands of people. Effective, blunt, and worth having as a break-glass option.

**3. Introduce a denylist.** Store the compromised token's identifier and check every request against it. Immediate and precise — and you have just made the system stateful. Every request now costs a lookup, which is the property you chose JWTs to avoid. The mitigating detail: the denylist only needs to hold entries until their tokens expire, so it stays small and bounded, unlike a full session store.

**4. Bump a per-user token version.** Store one integer per user; include it as a claim; reject tokens whose claim does not match. Immediate and per-user, and it is also a lookup — though a very cheap and cacheable one.

**The design conclusion, and this is the point:** any mechanism that gives you immediate revocation reintroduces server state. There is no stateless revocation, because revocation is by definition a change of server-side opinion that the token cannot know about.

**What good designs actually do:** short-lived access tokens (5-15 minutes) paired with a long-lived refresh token that *is* a reference token checked against server state. Access tokens stay stateless and fast; revocation happens at refresh time, so the worst-case exposure is one access-token lifetime rather than one session. You get most of the statelessness and bounded revocation latency, and the cost is a second token type and a refresh flow to implement correctly.

That hybrid is the standard answer, and being able to derive it — rather than recall it — is what the question is testing.`,
    },
    body: `## Sessions: the reference-token design

The client holds an opaque random identifier, usually in a cookie. The server holds the session record.

\`\`\`
Set-Cookie: sid=8f3a...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600
\`\`\`

Every attribute is load-bearing:

- **\`HttpOnly\`** — JavaScript cannot read it, so a cross-site scripting flaw cannot exfiltrate the session.
- **\`Secure\`** — never sent over plain HTTP.
- **\`SameSite=Lax\`** (or \`Strict\`) — not sent on cross-site requests, which removes most cross-site request forgery. \`Lax\` still allows top-level navigation, which is usually what you want; \`Strict\` breaks inbound links from other sites.
- **Expiry** — both an *idle* timeout (revoke after inactivity) and an *absolute* one (revoke regardless of activity). Only having idle expiry means an active attacker keeps a stolen session indefinitely.

Two operational rules that are frequently missed:

**Rotate the session identifier on privilege change.** After login, and after any elevation. Otherwise an attacker who fixed a known identifier into the victim's browser before login inherits the authenticated session — session fixation.

**Store sessions where every instance can reach them, and expect that store to be on the critical path.** Sessions in local process memory means a restart logs everyone out and a load balancer must pin users to instances. A shared store — Redis, or a database — is the usual answer, and it is now a dependency of every authenticated request.

**What sessions cost:** a lookup per request, and a store whose availability is your availability.

**What they buy:** instant revocation, the ability to enumerate active sessions ("sign out my other devices"), and no ability for a client to hold data you cannot change.

## JWTs: the self-contained design

Three base64url segments separated by dots: header, payload, signature.

\`\`\`
{ "alg": "RS256", "kid": "2026-09" }
{ "sub": "usr_7f3a", "exp": 1757000000, "iat": 1756999100,
  "iss": "https://auth.example.com", "aud": "api.example.com",
  "roles": ["admin"] }
\`\`\`

The signature proves the payload was issued by the holder of the signing key and has not been altered. Note what it does **not** provide:

**It is not encrypted.** Base64 is encoding, not encryption. Anyone holding the token can read every claim. Putting anything confidential in a JWT publishes it to the client and to any log that captured it.

**It cannot be revoked.** Verification consults no state, so nothing can express "not this one any more".

Six verification rules, each of which has been the cause of real compromises:

1. **Specify the expected algorithm.** Never trust the \`alg\` header. Accepting \`alg: none\`, or accepting an HMAC-signed token when you expected RSA (so the public key becomes the HMAC secret), are both classic bypasses.
2. **Verify \`exp\`**, and reject a token with no expiry.
3. **Verify \`iss\`** — that you issued it, or the identity provider you trust did.
4. **Verify \`aud\`** — that it was intended for *this* service. Without this, a token for a low-privilege service is accepted by a high-privilege one.
5. **Pin key material by \`kid\`** and rotate deliberately. Fetching keys from a URL named in the token is a straightforward compromise.
6. **Keep the payload small.** It rides on every request, and a token with fifty claims is a header on every call forever.

**What JWTs cost:** no revocation, claims that are stale from the moment of issue, and a signature-verification implementation where several plausible-looking mistakes are complete bypasses.

**What they buy:** no lookup per request, so any instance can verify without shared state. That matters most when many independent services must authenticate the same caller without all depending on one session store.

## The hybrid that is almost always the right answer

- **Access token:** JWT, 5-15 minutes, stateless verification, carries identity and coarse claims.
- **Refresh token:** opaque reference, long-lived, stored server-side, single-use with rotation.

The refresh endpoint is the control point. It checks server state, so revocation, permission changes and forced logout all take effect within one access-token lifetime. Everything else stays stateless and fast.

Two details that make refresh tokens safe rather than a bigger version of the problem:

**Rotate on use.** Each refresh returns a new refresh token and invalidates the old one.

**Detect reuse.** If an already-used refresh token is presented, either the token was stolen or a client is buggy. Either way, revoke the whole token family and force re-authentication. This is what makes a stolen refresh token detectable rather than silently exploitable.

## OAuth2 and OIDC: two different problems

The most common conceptual error in this area:

**OAuth2 is authorisation *delegation*.** It answers: how does a third-party application obtain permission to act on a user's behalf, without the user handing over their password? The output is an access token scoped to particular permissions.

**OIDC is authentication, built on top of OAuth2.** It answers: who is this user? The output is an **ID token** — a JWT with standard claims about identity — plus a \`/userinfo\` endpoint.

If you want "sign in with X", you want OIDC. Using a bare OAuth2 access token as proof of identity is unsafe: it was issued for a different audience, so a token obtained by any other application can be replayed at yours. The audience check exists precisely to prevent this.

The grant to know is **authorisation code with PKCE**, and it is now the recommended flow for every client type including single-page applications:

1. The client redirects the user to the authorisation server with a hash of a locally generated secret (the PKCE challenge).
2. The user authenticates there; your application never sees the credential.
3. The authorisation server redirects back with a short-lived *code*.
4. The client exchanges the code plus the original secret for tokens.

The code goes through the browser (where it can leak into logs and history) but is useless without the secret, which never leaves the client. That is what PKCE adds, and it is why the older implicit grant — which returned the token itself in the redirect — is no longer recommended.

## Where the token lives in a browser

A real decision with no clean answer:

- **\`localStorage\`** — readable by any script on the page, so any XSS flaw exfiltrates it. Convenient and the weakest option.
- **A cookie with \`HttpOnly\`** — unreadable by script, and requires CSRF protection because the browser attaches it automatically. Usually the right choice.
- **In memory only** — safest against exfiltration, lost on every page reload, so it needs a silent refresh flow.

Choose the cookie, add \`SameSite\`, and treat XSS as the thing that defeats every option — because a script running in your page can make authenticated requests regardless of where the token is stored.

## Authorisation is a separate concern

Authentication establishes identity; authorisation decides what that identity may do. Two consequences worth stating:

**Claims in a token are a cache.** A \`roles\` claim was true when the token was issued. Revoking an admin role does not reach existing tokens, which is the revocation problem again in a different costume. Coarse claims in the token plus fine-grained checks against current state is the usual compromise.

**Never authorise on network position or on the token alone in a multi-service system.** A token proves who the caller is; it does not establish that *this* service should honour that identity for *this* resource. The \`aud\` claim is the minimum, and per-resource checks are the actual answer.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'auth-tradeoff',
      title: 'The one trade-off, and the hybrid that splits it',
      caption:
        'Read the two columns as a single axis: server state bought revocation, statelessness bought scale. The bottom row is not a compromise between them — it applies each where its cost is lowest.',
      code: `flowchart TB
    subgraph SESS["Reference token (session)"]
      S1[Opaque random id in a cookie]
      S2[Server holds the state]
      S3["✓ Instant revocation<br/>✓ Enumerate active sessions<br/>✓ Claims always current"]
      S4["✗ A lookup on every request<br/>✗ Session store availability<br/>  is your availability"]
    end

    subgraph JWT["Self-contained token (JWT)"]
      J1[Signed claims held by the client]
      J2[Server verifies, consults nothing]
      J3["✓ No lookup, any instance verifies<br/>✓ Scales without shared state"]
      J4["✗ Cannot be revoked<br/>✗ Claims stale from issue<br/>✗ Readable by anyone holding it"]
    end

    subgraph HYB["The hybrid"]
      H1["Access token: JWT, 5-15 min<br/>stateless verification"]
      H2["Refresh token: opaque reference<br/>checked against server state"]
      H3["Revocation latency bounded by<br/>one access-token lifetime"]
      H4["Refresh rotated on use;<br/>reuse revokes the whole family"]
    end

    SESS --> HYB
    JWT --> HYB

    style S3 fill:#17272a,stroke:#35897e
    style J3 fill:#17272a,stroke:#35897e
    style S4 fill:#2a1d1d,stroke:#b8383b
    style J4 fill:#2a1d1d,stroke:#b8383b
    style HYB fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'oidc-flow',
      title: 'Authorisation code with PKCE, and what each step protects',
      caption:
        'Step through it. The design goal is that no single leaked artefact is sufficient: the code travels through the browser and is useless without the verifier, which never leaves the client.',
      nodes: [
        { id: 'user', label: 'User', kind: 'actor', x: 0, y: 130, detail: 'Authenticates at the identity provider, never at your application. That separation is the entire point — your code never handles the credential.' },
        { id: 'client', label: 'Your application', kind: 'client', x: 180, y: 130, detail: 'Generates a random verifier, keeps it locally, and sends only its hash. Possession of the verifier is what proves the code is being redeemed by whoever requested it.' },
        { id: 'idp', label: 'Identity provider', kind: 'external', x: 400, y: 40, detail: 'Authenticates the user and issues a short-lived code bound to the challenge. It never sees the verifier until redemption.' },
        { id: 'token', label: 'Token endpoint', kind: 'external', x: 620, y: 40, detail: 'Exchanges code plus verifier for an ID token (who the user is) and an access token (what may be done). Rejects a code presented without the matching verifier.' },
        { id: 'api', label: 'Your API', kind: 'service', x: 620, y: 230, detail: 'Verifies the access token: expected algorithm, expiry, issuer, and audience. The audience check is what stops a token minted for another application being replayed here.' },
        { id: 'jwks', label: 'Key set', kind: 'store', x: 400, y: 230, detail: 'Public keys, fetched by key id and cached. Never fetch keys from a URL named inside the token being verified — that is a straightforward compromise.' },
      ],
      edges: [
        { id: 'o1', source: 'client', target: 'idp', label: 'redirect + challenge', kind: 'control' },
        { id: 'o2', source: 'user', target: 'idp', label: 'authenticate', kind: 'sync' },
        { id: 'o3', source: 'idp', target: 'client', label: 'code', kind: 'control' },
        { id: 'o4', source: 'client', target: 'token', label: 'code + verifier', kind: 'sync' },
        { id: 'o5', source: 'token', target: 'client', label: 'ID + access token', kind: 'sync' },
        { id: 'o6', source: 'client', target: 'api', label: 'access token', kind: 'sync' },
        { id: 'o7', source: 'api', target: 'jwks', label: 'public key by kid', kind: 'read' },
      ],
      steps: [
        {
          id: 'n1',
          title: 'The credential never reaches your application',
          description:
            'You redirect to the identity provider with a hash of a locally generated verifier. The user authenticates there. Your code never sees a password, which removes the largest category of credential-handling risk entirely.',
          nodes: ['client', 'user', 'idp'],
          edges: ['o1', 'o2'],
        },
        {
          id: 'n2',
          title: 'The code travels through the browser and is useless alone',
          description:
            'A redirect parameter can leak into browser history, referrer headers and server logs. Binding the code to the PKCE challenge means a leaked code cannot be redeemed without the verifier — which is exactly what the older implicit grant failed to protect.',
          nodes: ['idp', 'client', 'token'],
          edges: ['o3', 'o4'],
        },
        {
          id: 'n3',
          title: 'Two tokens, two purposes',
          description:
            'The ID token says who the user is; the access token says what may be done. Using an access token as proof of identity is the classic error, because it was minted for a different audience and can be obtained by another application.',
          nodes: ['token', 'client'],
          edges: ['o5'],
        },
        {
          id: 'n4',
          title: 'Verification is where the bypasses live',
          description:
            'Expected algorithm rather than the header\'s claim, expiry, issuer, and audience — all four, every time. Keys fetched by key id from a pinned endpoint, never from a URL the token supplies.',
          nodes: ['client', 'api', 'jwks'],
          edges: ['o6', 'o7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest production pattern is the one almost every large system converges on, and it is worth seeing why the convergence happens rather than treating it as fashion.

A typical architecture ends up with three layers:

**An identity provider owning authentication.** One system holds credentials, runs multi-factor authentication, manages account recovery and issues tokens. Concentrating this is a security decision: credential handling, password storage and recovery flows are where breaches actually occur, and having one hardened implementation is dramatically safer than fifty adequate ones. It is also an operational decision — the provider becomes a dependency of every login, so it needs to be more available than the services behind it.

**Short-lived access tokens verified statelessly at the edge and in services.** An API gateway validates signature, expiry, issuer and audience once, then passes the verified identity inward. Services do not each fetch keys and re-implement verification, which matters because verification is where the exploitable mistakes are — centralising it means getting it right once.

**A refresh flow as the control point.** Because access tokens live minutes rather than hours, the refresh endpoint is where server state is consulted: is this session still valid, has the user been disabled, have permissions changed. Revocation latency is bounded by the access-token lifetime rather than the session lifetime, and it costs one lookup per refresh instead of one per request.

Two things this shape gets right that a naive design does not:

**It puts state exactly where its cost is lowest.** Per-request lookups would be the hot path; per-refresh lookups happen once every ten minutes per user. Same mechanism, three orders of magnitude less traffic.

**It makes the audience check meaningful.** With many services behind one identity provider, a token minted for the reporting API must not be accepted by the payments API. That is only true if every service verifies \`aud\`, which is why centralising verification at a gateway is safer than trusting each team to remember.

The transferable lesson: **when a trade-off looks forced, check whether it can be split across two different operations.** Revocation versus statelessness looks binary until you notice that authentication happens on every request and re-authorisation does not — at which point you can pay for state only in the rarer path. That move recurs throughout system design, and this is one of its cleanest instances.`,
  },

  tradeoffs: {
    intro:
      'The axis is where session state lives. Rows are ordered from most server state to least, and the last row is where most systems should end up.',
    rows: [
      {
        option: 'Server-side sessions with an opaque cookie',
        whenItWins:
          'Traditional web applications, anything needing instant revocation or session enumeration, and any system where a single session store is acceptable.',
        whenItLoses:
          'Many independent services that would all have to depend on one session store, and high-throughput APIs where a per-request lookup is material.',
        cost:
          'A lookup on every request, and the session store\'s availability becomes your availability.',
      },
      {
        option: 'Stateless JWTs only',
        whenItWins:
          'Genuinely nowhere for a user-facing session, and legitimately for short-lived machine-to-machine credentials where revocation is not required.',
        whenItLoses:
          'Any system that must be able to log a user out, disable an account promptly, or apply a permission change quickly.',
        cost:
          'No revocation, claims stale from the moment of issue, and verification code where several plausible mistakes are complete bypasses.',
      },
      {
        option: 'JWTs with a denylist',
        whenItWins:
          'When you have already committed to stateless tokens and need targeted revocation for incidents.',
        whenItLoses:
          'As a general design — it reintroduces a per-request lookup, which is the property JWTs were chosen to avoid.',
        cost:
          'A lookup per request, though the denylist stays small because entries expire with their tokens.',
      },
      {
        option: 'Per-user token version claim',
        whenItWins:
          'Bulk revocation per user — password change, forced logout everywhere — with a cheap, highly cacheable lookup.',
        whenItLoses:
          'Revoking one device while leaving others signed in, since the version is per user rather than per session.',
        cost:
          'One integer per user to store and check, and a cache invalidation path when it changes.',
      },
      {
        option: 'Short-lived JWT access token plus opaque refresh token',
        whenItWins:
          'Almost all modern systems. Stateless verification on the hot path, server-side control at refresh time, revocation bounded by the access-token lifetime.',
        whenItLoses:
          'Very simple single-server applications, where a plain session is less machinery for the same result.',
        cost:
          'Two token types, a refresh flow with rotation and reuse detection, and clients that must handle expiry correctly.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use JWTs so we do not need a session store — it is stateless and scales better."',
      whyWeak:
        'It states the benefit and omits the cost. Stateless verification means nothing consults you, so you cannot log a user out, cannot disable a compromised account promptly, and a permission change does not apply until the token expires. Those are not bugs to fix later; they are the design.',
      strongAnswer:
        '"Stateless verification buys us no per-request lookup, and it costs revocation. So I would use short-lived access tokens — around ten minutes — with an opaque refresh token checked against server state. The hot path stays stateless, and revocation takes effect within one access-token lifetime."',
    },
    {
      weakAnswer: '"The JWT is signed, so the claims inside it are secure."',
      whyWeak:
        'Signed means tamper-evident, not confidential. The payload is base64, which is encoding rather than encryption — anyone holding the token reads every claim, as does any log or proxy that captured it. Teams routinely put email addresses, internal ids and role structures in tokens on this misunderstanding.',
      strongAnswer:
        '"The signature proves integrity and origin, not confidentiality — the payload is readable by anyone with the token. So it carries a subject, expiry, issuer, audience and coarse claims, and nothing sensitive. Anything confidential stays server-side and is fetched with the identity the token establishes."',
    },
    {
      weakAnswer: '"We verify the signature using the algorithm specified in the token header."',
      whyWeak:
        'That trusts the attacker to tell you how to check their own token. Accepting `alg: none` skips verification; accepting HMAC where you expected RSA lets an attacker sign with your public key as the shared secret. Both are complete authentication bypasses and both have occurred in real libraries.',
      strongAnswer:
        '"The expected algorithm is configured on the verifier, and the header\'s claim is never used to choose it. Alongside that, I verify expiry, issuer and audience — audience especially, because without it a token minted for a low-privilege service is accepted by a high-privilege one."',
    },
    {
      weakAnswer: '"We use the OAuth2 access token from the provider to identify the user."',
      whyWeak:
        'OAuth2 delegates authorisation, not authentication. An access token was issued to some application for some scope, and a token obtained by any *other* application can be presented at yours — so it proves nothing about who is calling. This is the confused-deputy problem and it is a real vulnerability, not a purity argument.',
      strongAnswer:
        '"For identity I would use OIDC and the ID token, which is a JWT with standard identity claims and an audience of my application. The access token is for calling APIs on the user\'s behalf. Treating an access token as proof of identity means any application holding one can impersonate its user at my service."',
    },
    {
      weakAnswer: '"Tokens are stored in localStorage so the SPA can read them across tabs."',
      whyWeak:
        'Any script running on the page can read `localStorage`, so a single cross-site scripting flaw — in your code or in any dependency — exfiltrates the token to an attacker who can then use it from anywhere until it expires.',
      strongAnswer:
        '"I would use an HttpOnly, Secure, SameSite cookie so script cannot read it, and add CSRF protection because the browser attaches cookies automatically. That said, XSS defeats every storage option — a script in the page can make authenticated requests regardless — so the cookie reduces exfiltration rather than eliminating the risk."',
    },
    {
      weakAnswer: '"Refresh tokens are long-lived so users stay signed in — we reuse the same one until it expires."',
      whyWeak:
        'A long-lived reusable refresh token is a long-lived credential with no theft detection. If it is stolen, the attacker holds indefinite access and there is no signal distinguishing their use from the legitimate client\'s.',
      strongAnswer:
        '"Refresh tokens rotate on every use: each refresh returns a new one and invalidates the old. If an already-used token is presented, either it was stolen or the client is buggy, so I revoke the whole token family and force re-authentication. Rotation is what makes theft detectable rather than silently exploitable."',
    },
  ],

  flashcards: [
    {
      id: 'fc-auth-1',
      front: 'What is the single trade-off underlying session design?',
      back: 'Statelessness buys scale and costs revocation. Server-side state costs a lookup per request and buys instant control.',
      topic: 'sessions',
    },
    {
      id: 'fc-auth-2',
      front: 'Why can a stateless JWT not be revoked?',
      back: 'Verification consults no server state, so there is nowhere to record "not this one any more". Any mechanism that fixes it reintroduces a lookup.',
      topic: 'revocation',
    },
    {
      id: 'fc-auth-3',
      front: 'What does a JWT signature prove, and what does it not?',
      back: 'It proves the payload was issued by the key holder and has not been altered. It does not make the payload confidential — base64 is encoding, so anyone holding the token reads every claim.',
      topic: 'jwt',
    },
    {
      id: 'fc-auth-4',
      front: 'Why must you never verify a JWT using the algorithm in its header?',
      back: 'It lets the attacker choose how their token is checked. `alg: none` skips verification, and accepting HMAC where RSA was expected turns your public key into the shared secret. Both are complete bypasses.',
      topic: 'jwt',
    },
    {
      id: 'fc-auth-5',
      front: 'What does the `aud` claim prevent?',
      back: 'A token minted for one service being replayed at another. Without an audience check, a token for a low-privilege API is accepted by a high-privilege one.',
      topic: 'jwt',
    },
    {
      id: 'fc-auth-6',
      front: 'What are the four essential session cookie attributes and what does each do?',
      back: 'HttpOnly (script cannot read it, so XSS cannot exfiltrate), Secure (never over plain HTTP), SameSite (not sent cross-site, blocking most CSRF), and expiry — both idle and absolute.',
      topic: 'sessions',
    },
    {
      id: 'fc-auth-7',
      front: 'Why rotate the session identifier after login?',
      back: 'To prevent session fixation: an attacker who planted a known identifier in the victim\'s browser before login would otherwise inherit the authenticated session.',
      topic: 'sessions',
    },
    {
      id: 'fc-auth-8',
      front: 'What is the difference between OAuth2 and OIDC?',
      back: 'OAuth2 delegates authorisation — permission for an application to act on a user\'s behalf. OIDC adds authentication on top, issuing an ID token that says who the user is.',
      topic: 'oauth',
    },
    {
      id: 'fc-auth-9',
      front: 'Why is using an OAuth2 access token as proof of identity unsafe?',
      back: 'It was issued to some application for some scope with some audience. A token obtained by a different application can be presented at yours, so it establishes nothing about the caller.',
      topic: 'oauth',
    },
    {
      id: 'fc-auth-10',
      front: 'What does PKCE add to the authorisation code flow?',
      back: 'The client sends a hash of a locally held secret; the code is bound to it. A code leaked from browser history, a referrer or a log cannot be redeemed without the verifier, which never leaves the client.',
      topic: 'oauth',
    },
    {
      id: 'fc-auth-11',
      front: 'Why must refresh tokens rotate on use, and what does reuse mean?',
      back: 'Rotation makes theft detectable. Presentation of an already-used token means either theft or a client bug, so the correct response is to revoke the whole family and force re-authentication.',
      topic: 'revocation',
    },
    {
      id: 'fc-auth-12',
      front: 'Why are role claims in a token a cache rather than a fact?',
      back: 'They were true at issue time. Revoking a role does not reach existing tokens, so coarse claims in the token plus fine-grained checks against current state is the usual compromise.',
      topic: 'authorization',
    },
    {
      id: 'fc-auth-13',
      front: 'What is the standard hybrid, and what does it bound?',
      back: 'Short-lived stateless JWT access tokens plus an opaque server-checked refresh token. Revocation latency is bounded by the access-token lifetime rather than the session lifetime.',
      topic: 'authentication',
    },
  ],

  quiz: [
    {
      id: 'q-auth-1',
      kind: 'scenario',
      prompt:
        'A compromised account must be locked out immediately. The system uses stateless JWTs with a 2-hour expiry. Which option is both immediate and least disruptive?',
      options: [
        { id: 'a', label: 'Bump a per-user token version claim and reject tokens whose version does not match' },
        { id: 'b', label: 'Rotate the signing key' },
        { id: 'c', label: 'Wait for the token to expire' },
        { id: 'd', label: 'Shorten the expiry to 5 minutes going forward' },
      ],
      correct: ['a'],
      explanation:
        'A per-user version is immediate and scoped to that user, at the cost of one cheap cacheable lookup — which is the honest admission that revocation requires server state. Key rotation works and logs out everyone. Waiting gives two hours of access, and changing the expiry does nothing to tokens already issued.',
      difficulty: 'core',
      topic: 'revocation',
    },
    {
      id: 'q-auth-2',
      kind: 'scenario',
      prompt:
        'A service accepts JWTs and reads the `alg` header to select a verification algorithm. An attacker submits a token with `alg: HS256` signed using the service\'s published RSA public key as the HMAC secret. What happens?',
      options: [
        { id: 'a', label: 'Verification succeeds and the attacker can mint arbitrary tokens — a complete authentication bypass' },
        { id: 'b', label: 'Verification fails because the key type does not match' },
        { id: 'c', label: 'Verification fails because the signature length is wrong' },
        { id: 'd', label: 'Verification succeeds but the claims are rejected as malformed' },
      ],
      correct: ['a'],
      explanation:
        'The service was told to use HMAC and had one key available, so it uses the public key as the shared secret — which the attacker also has, because it is public. This is a well-known bypass and the reason the expected algorithm must be configured on the verifier rather than read from the token.',
      difficulty: 'advanced',
      topic: 'jwt',
    },
    {
      id: 'q-auth-3',
      kind: 'single',
      prompt: 'What does a JWT signature guarantee?',
      options: [
        { id: 'a', label: 'The payload was issued by the key holder and has not been altered' },
        { id: 'b', label: 'The payload is confidential and unreadable by the client' },
        { id: 'c', label: 'The token has not been revoked' },
        { id: 'd', label: 'The claims are currently accurate' },
      ],
      correct: ['a'],
      explanation:
        'Integrity and origin only. The payload is base64-encoded and fully readable. Nothing about a signature relates to revocation, since verification consults no state, and claims reflect the moment of issue rather than the present.',
      difficulty: 'intro',
      topic: 'jwt',
    },
    {
      id: 'q-auth-4',
      kind: 'scenario',
      prompt:
        'A "Sign in with Provider" integration takes the OAuth2 access token returned by the provider and treats the associated user id as the signed-in identity. What is the vulnerability?',
      options: [
        { id: 'a', label: 'An access token obtained by any other application can be presented here, so it proves nothing about who is calling' },
        { id: 'b', label: 'Access tokens expire too quickly for session use' },
        { id: 'c', label: 'The access token is not encrypted in transit' },
        { id: 'd', label: 'The provider may rotate the user id' },
      ],
      correct: ['a'],
      explanation:
        'This is the confused-deputy problem. An access token is authorisation for a particular application and audience; presenting one does not establish the presenter\'s identity. OIDC exists for this: the ID token carries identity claims with an audience of your application, and the audience check is what makes it sound.',
      difficulty: 'advanced',
      topic: 'oauth',
    },
    {
      id: 'q-auth-5',
      kind: 'scenario',
      prompt:
        'A single-page application stores its access token in `localStorage`. A dependency ships a compromised version that reads it and posts it to an external host. What would storing it differently have changed?',
      options: [
        { id: 'a', label: 'An HttpOnly cookie would have prevented exfiltration, though the script could still make authenticated requests from the page' },
        { id: 'b', label: 'Nothing — all browser storage is equally readable by scripts' },
        { id: 'c', label: 'A cookie would have prevented the compromised dependency from running at all' },
        { id: 'd', label: 'sessionStorage would have prevented it, being scoped to the tab' },
      ],
      correct: ['a'],
      explanation:
        'HttpOnly makes the value unreadable from script, so the token cannot be sent elsewhere and used from an attacker\'s machine. The script can still act within the page while it runs, which is why XSS is severe regardless — the cookie bounds the damage to the session rather than eliminating it. sessionStorage is equally script-readable.',
      difficulty: 'core',
      topic: 'sessions',
    },
    {
      id: 'q-auth-6',
      kind: 'multi',
      prompt: 'Which checks must a JWT verifier perform? Select all that apply.',
      options: [
        { id: 'a', label: 'Signature using an algorithm the verifier specifies, not the one in the header' },
        { id: 'b', label: 'Expiry, rejecting tokens with no expiry claim' },
        { id: 'c', label: 'Audience, so a token for another service is not accepted' },
        { id: 'd', label: 'That the token appears in an allowlist of issued tokens' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the essential stateless checks, along with issuer. An allowlist of issued tokens would work and would make the design stateful — which is a legitimate choice, but it is no longer stateless verification and should be adopted deliberately rather than as an extra check.',
      difficulty: 'core',
      topic: 'jwt',
    },
    {
      id: 'q-auth-7',
      kind: 'scenario',
      prompt:
        'A user changes their password. Access tokens are JWTs valid for 15 minutes; refresh tokens are opaque and server-checked. What is the exposure window for a session an attacker had already established?',
      options: [
        { id: 'a', label: 'Up to 15 minutes — their access token stays valid, but the refresh will be rejected' },
        { id: 'b', label: 'None — the password change invalidates the access token immediately' },
        { id: 'c', label: 'Indefinite, because JWTs cannot be revoked' },
        { id: 'd', label: 'Until the refresh token expires' },
      ],
      correct: ['a'],
      explanation:
        'This is precisely what the hybrid buys: revocation latency bounded by the access-token lifetime rather than the session lifetime. Invalidating refresh tokens on password change stops renewal; the outstanding access token runs out its remaining minutes. If 15 minutes is too long for your threat model, shorten it and pay more refresh traffic.',
      difficulty: 'core',
      topic: 'authentication',
    },
  ],

  exercises: [
    {
      id: 'ex-auth-1',
      kind: 'design',
      title: 'Design authentication for a system with conflicting requirements',
      estimatedMinutes: 25,
      prompt: `Design authentication and session management for a healthcare platform:

- Clinicians use a web application; patients use a mobile app.
- 40 backend services, deployed independently by 8 teams.
- Regulatory requirement: a revoked clinician must lose access within 60 seconds.
- Regulatory requirement: every access to a patient record must be attributable to a named individual, retained for audit.
- Clinicians work 12-hour shifts and must not be asked to re-authenticate mid-shift.
- Peak load is 40,000 authenticated requests per second.
- Some services are on a partner network you do not operate.

Produce: the token design with lifetimes, where state lives, how the 60-second requirement is met, what each of the 40 services must verify, and the two requirements that are in tension plus how you resolve them.`,
      rubric: [
        'Identifies the tension between 60-second revocation and 40,000 requests/second stateless verification, and resolves it explicitly rather than picking one.',
        'Identifies the second tension: 12-hour shifts without re-authentication versus bounded revocation, resolved by long refresh with short access tokens.',
        'Chooses short-lived access tokens (well under 60 seconds of slack) plus server-checked refresh, with concrete lifetimes justified by the 60-second requirement.',
        'Explains how the 60-second requirement is met with a mechanism, not an aspiration — access-token lifetime plus a revocation check, with arithmetic.',
        'Specifies exactly what every service verifies: configured algorithm, expiry, issuer, audience, and key by kid from a pinned endpoint.',
        'Addresses the partner-network services as a distinct audience with separate tokens, so a partner token cannot reach patient records.',
        'Addresses the audit requirement as a separate concern from authentication, tied to the subject claim and a request identifier.',
      ],
      modelAnswer: `**The two tensions, stated first**

1. **60-second revocation versus 40,000 rps stateless verification.** A per-request check against a revocation store at 40,000 rps is possible but makes that store a dependency of every request in a healthcare system. Purely stateless verification cannot meet 60 seconds unless tokens live under 60 seconds, which means very high refresh traffic.

2. **12-hour shifts without re-authentication versus bounded revocation.** A 12-hour credential and a 60-second revocation requirement are directly opposed if they are the same credential.

Both resolve the same way: **separate the credential that lasts a shift from the credential that is presented on each request.**

**Token design**

| Token | Type | Lifetime | Where verified |
| --- | --- | --- | --- |
| Access token | JWT (RS256) | **45 seconds** | Statelessly, in every service |
| Refresh token | Opaque reference | 13 hours, rotated on use | Auth service, against server state |

45 seconds is derived rather than chosen: the requirement is 60 seconds, so the access-token lifetime plus clock skew tolerance plus refresh latency must fit inside it. 45 seconds of token life plus a few seconds of skew leaves comfortable margin.

**How the 60-second requirement is met**

Revocation writes to a revocation store. A clinician's refresh attempt is rejected within milliseconds of that write. Their outstanding access token remains valid for at most its remaining life — under 45 seconds. **Worst case total: 45 seconds plus skew, inside the 60-second requirement, with no per-request state.**

The arithmetic is the answer, and it is worth showing to whoever wrote the requirement.

**Cost of 45-second tokens:** with 40,000 rps and a 45-second lifetime, refresh traffic is roughly one refresh per active session per 45 seconds. For, say, 20,000 concurrent clinicians that is about 450 refreshes per second — three orders of magnitude below the request rate, and the auth service is sized for that rather than for 40,000. This is the whole point of putting state in the rarer path.

**Where state lives**

- **Refresh token store** (durable, replicated): token family, user, device, rotation counter, revoked flag.
- **Revocation store** (low-latency, replicated): user identifiers revoked, with entries expiring after the maximum access-token lifetime so it stays small.
- **No per-request session state**, which is what makes 40,000 rps affordable.

**What every one of the 40 services must verify**

Not left to 8 teams to remember. A shared library, and verification also performed at the gateway:

1. Signature with **RS256 configured on the verifier** — never read from the header.
2. \`exp\`, rejecting a token without one.
3. \`iss\` matches our identity provider.
4. \`aud\` matches **this service's own identifier**.
5. Public key selected by \`kid\` from a pinned, cached key endpoint — never a URL inside the token.

Point 4 is the one teams skip and it is load-bearing here: with 40 services, an unaudienced token means a token minted for a scheduling service is accepted by the record service.

**Partner-network services**

Treated as a distinct trust domain. Partner-facing tokens carry a **different audience** and a restricted scope set, and they are never accepted by services holding patient records. Cross-domain calls go through an explicit exchange at the auth service that mints a new token for the target audience, so a partner token can never be replayed inward. Mutual TLS between our services and the partner network, because being on that network must not imply anything.

**Audit attribution**

A separate concern that authentication merely enables. Every access token carries \`sub\` (a stable clinician identifier). Every request carries a request identifier. The audit record — written by the record service, not by the gateway — stores subject, resource, action, timestamp and request identifier.

Two details worth stating: the audit write must be **durable before the data is returned**, otherwise an access can occur without a record; and audit records must be written on **denied** attempts too, since an attempted access to a record is exactly what an investigation cares about.

**What I would flag to the requirement owners**

45-second access tokens mean clients must handle refresh transparently and tolerate a token expiring mid-flight. That is real client complexity, and if the mobile app cannot do it reliably, the honest alternatives are longer tokens with a per-request revocation check — accepting the store on the hot path — or renegotiating 60 seconds. I would rather present that choice with numbers than silently ship a design that misses the requirement.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-auth-1',
      level: 'basic',
      question: 'What is the difference between authentication and authorisation?',
      guidance:
        'Who you are versus what you may do. A strong answer notes that authorisation changes far more often than identity, which is why baking permissions into a long-lived token causes problems.',
    },
    {
      id: 'iq-auth-2',
      level: 'basic',
      question: 'Sessions or JWTs — how do you choose?',
      guidance:
        'The trade is revocation versus per-request state. A strong answer refuses the binary and describes the hybrid: short-lived stateless access tokens plus a server-checked refresh token, with revocation latency bounded by the access-token lifetime.',
    },
    {
      id: 'iq-auth-3',
      level: 'intermediate',
      question: 'How do you revoke a JWT?',
      guidance:
        'You cannot, statelessly. Options are waiting for expiry, key rotation (logs everyone out), a denylist, or a per-user version claim — and every option that works reintroduces server state. A strong answer says that explicitly rather than presenting a denylist as though it were free.',
    },
    {
      id: 'iq-auth-4',
      level: 'intermediate',
      question: 'What must a service check when verifying a JWT?',
      guidance:
        'Signature with a configured algorithm, expiry, issuer, audience, and key selected by kid from a pinned endpoint. Look for the emphasis on not trusting the header\'s algorithm, and for audience being named — it is the check most often omitted in multi-service systems.',
    },
    {
      id: 'iq-auth-5',
      level: 'advanced',
      question: 'Explain OAuth2 versus OIDC, and when you need each.',
      guidance:
        'OAuth2 delegates authorisation; OIDC adds authentication with an ID token. "Sign in with X" needs OIDC. A strong answer explains why using an access token as proof of identity is a real vulnerability — a token obtained by another application can be replayed — rather than merely incorrect.',
    },
    {
      id: 'iq-auth-6',
      level: 'advanced',
      question: 'Design authentication for 30 services owned by 6 teams at high request volume.',
      guidance:
        'Central identity provider, short-lived audienced access tokens verified statelessly by a shared library and at the gateway, refresh as the control point. Excellent answers put state in the rare path and show the arithmetic, and insist verification is centralised rather than reimplemented per team.',
    },
    {
      id: 'iq-auth-7',
      level: 'followup',
      question: 'Where should a browser store an access token?',
      guidance:
        'An HttpOnly Secure SameSite cookie, with CSRF protection because cookies are sent automatically. A strong answer concedes that XSS defeats every option — a script in the page can act regardless — so the cookie bounds exfiltration rather than eliminating risk.',
    },
    {
      id: 'iq-auth-8',
      level: 'followup',
      question: 'You have short access tokens and long refresh tokens. What stops a stolen refresh token being used indefinitely?',
      guidance:
        'Rotation on use plus reuse detection: presenting an already-used refresh token means theft or a client bug, so the whole family is revoked. A strong answer notes that without rotation a refresh token is simply a long-lived credential with no theft signal, and that binding it to a device adds a second signal.',
    },
  ],

  activeLearning: [
    {
      id: 'al-auth-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson assumed human users. Now change it: the callers are 500 backend services authenticating to each other, with no humans involved. Which parts of the design survive, which become irrelevant, and what new problem appears?',
      discussion: `Roughly half survives, and the new problem is the one that defines the whole area.

**Survives, and matters more:**

*Short-lived audienced tokens.* Still exactly right, and the audience check becomes critical rather than merely important — with 500 services, an unaudienced token is a universal key. The lifetime can be shorter still, because a service can refresh transparently in a way a mobile client on a train cannot.

*Stateless verification.* Even more valuable: service-to-service call volume dwarfs human traffic, so a per-request lookup is unaffordable.

*Not trusting the algorithm header.* Unchanged. The bypasses do not care who the caller is.

**Becomes irrelevant:**

*Cookies, SameSite, CSRF, XSS, token storage in a browser.* All browser-specific concerns with no analogue here.

*Refresh tokens as designed.* A service does not "stay signed in" — it re-authenticates whenever it needs a token, so the access/refresh split loses its purpose. A service authenticates and receives a short-lived token directly.

*"Do not ask the user to re-authenticate."* There is no user experience to protect, which removes the constraint that forced long-lived credentials in the first place.

**The new problem, and it is the whole subject: how does a service prove who it is in the first place?**

A human presents a password or a passkey. A service has no memory and no fingers. Whatever it presents must have been given to it by something, which means the question recurses: how did *that* get there?

This is **secret zero**, and the available answers are instructive:

*A long-lived shared secret in configuration.* Works, and is the thing every mature system moves away from. It never expires, it appears in environment dumps and logs, rotating it requires coordinated redeployment, and 500 services means 500 credentials nobody has audited.

*A platform-attested identity.* The infrastructure the service runs on vouches for it — a cloud instance identity document, a Kubernetes service account token, a hardware root of trust. The service presents that attestation and exchanges it for a short-lived token. Secret zero moves to the platform, which is a much better place for it: the platform can rotate, and a stolen attestation is bound to a workload identity rather than being bearer-usable anywhere.

*Mutual TLS with short-lived workload certificates.* Identity is the certificate, issued by an internal authority at startup and rotated automatically. This is the service-mesh answer from the TLS lesson, and it collapses authentication and transport security into one mechanism.

**What this reveals about the human case.** The recursion does not actually stop for humans either — it stops at something outside the system: a person who can be asked for a second factor, or a physical device. Machine identity has no such anchor, so it must be delegated to the platform. That is why cloud workload identity and service meshes exist, and why "just put the API key in an environment variable" is the thing to argue against.

**Transferable:** whenever a design requires a credential, ask where that credential came from. If the answer is "configuration", you have a long-lived secret and the problem is unsolved rather than solved.`,
    },
    {
      id: 'al-auth-2',
      kind: 'debug',
      prompt:
        'Users report being unexpectedly signed out, roughly once a day each, at no consistent time. The system uses 15-minute JWTs and rotating refresh tokens with reuse detection. Nothing appears in error logs. What are your hypotheses?',
      discussion: `Rotating refresh tokens with reuse detection is a design that trades a specific new failure mode for theft detection, and this symptom is that failure mode's fingerprint.

**Leading hypothesis: a race between concurrent refreshes.**

Two tabs, or a tab plus a background sync, both notice the access token is near expiry and both refresh with the same refresh token. One wins and rotates it. The second presents a token that has just been consumed — which is indistinguishable from theft, so reuse detection revokes the entire family and signs the user out.

The signature fits precisely: roughly once a day per user (however often two contexts happen to refresh simultaneously), no consistent time, and **nothing in error logs** because from the server's perspective it behaved correctly and defensively.

**Second hypothesis: a lost response on the refresh call.** The client requests a refresh, the server rotates and responds, and the response is lost. The client retries with the old token — which has been consumed. Same outcome, different cause. This is the idempotency problem from the previous lesson appearing inside the auth flow, and it is worth recognising as the same shape.

**Third hypothesis: clock skew.** If a client's clock runs fast it may consider a token expired early and refresh more often, increasing the chance of a race. Contributory rather than causal.

**What to measure:**

1. **Reuse-detection events, with the user, timestamp, and the count of refreshes for that family in the preceding seconds.** Two refreshes within a second or two is a race, not an attack. This is the decisive measurement and it is almost certainly not currently instrumented, because the code path treats it as a security event rather than an error.
2. **Whether affected users had multiple tabs or a background process active.**
3. **Client-side retry behaviour on the refresh endpoint.**

**Fixes, and the trade each makes:**

*A short grace window.* Accept the previous refresh token for a few seconds after rotation, returning the *same* new token. Concurrent refreshes converge instead of colliding. The cost is a small window in which a stolen token is usable — genuinely a security reduction, and usually the right trade because the current behaviour is signing out legitimate users daily.

*Single-flight refresh in the client.* Ensure only one refresh is in progress per client, with other callers awaiting its result. Fixes the multi-tab race properly and needs cross-tab coordination, which is real work.

*Idempotent refresh.* Treat a refresh as an idempotent operation keyed on the presented token: the first call rotates and stores the result; a replay returns the same stored result. This is the cleanest fix and it is precisely the mechanism from the idempotency lesson — which is worth noticing, because it means the auth flow was missing a property the write path already knew it needed.

*Distinguish the signals.* Two refreshes seconds apart from the same device is a race; a refresh from a different IP and user agent hours later is theft. Reuse detection should weigh those differently rather than treating both as compromise.

**Transferable:** a security mechanism that cannot distinguish an attack from a benign race will produce false positives, and false positives in authentication look exactly like unreliability. When a defensive control fires, log enough context to tell the two apart — otherwise you cannot tune it, and you cannot even tell it is firing.`,
    },
  ],

  revision: {
    bullets: [
      'Three separate questions: who are you (authentication), what may you do (authorisation), how do I avoid asking again (sessions).',
      'The single trade: statelessness buys scale and costs revocation; server state costs a lookup and buys instant control.',
      'Reference tokens are opaque ids with server-side state. Self-contained tokens carry signed claims and consult nothing.',
      'A JWT signature proves integrity and origin, not confidentiality. Base64 is encoding — anyone with the token reads every claim.',
      'A stateless JWT cannot be revoked. Every fix — denylist, per-user version, key rotation — reintroduces state or logs out everyone.',
      'Never verify using the algorithm in the header. `alg: none` and HMAC-with-the-public-key are complete bypasses.',
      'Verify signature (configured algorithm), exp, iss, aud, and select keys by kid from a pinned endpoint.',
      'The audience check is what stops a token minted for one service being accepted by another.',
      'Session cookies: HttpOnly, Secure, SameSite, plus both idle and absolute expiry. Rotate the id on login.',
      'The standard hybrid: 5-15 minute stateless access tokens plus an opaque server-checked refresh token.',
      'That hybrid bounds revocation latency by the access-token lifetime and puts state in the rare path.',
      'Refresh tokens rotate on use; presenting a consumed one revokes the whole family.',
      'OAuth2 delegates authorisation; OIDC adds authentication with an ID token. "Sign in with X" needs OIDC.',
      'Using an access token as proof of identity is a real vulnerability — another application\'s token can be replayed at yours.',
      'PKCE binds the authorisation code to a secret that never leaves the client, so a leaked code is useless.',
      'Role claims are a cache: true at issue time, not now. Coarse claims plus fine-grained current checks.',
      'For services, the hard problem is secret zero — delegate identity to the platform rather than configuring long-lived secrets.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The mechanisms for establishing who a caller is and carrying that fact across requests: opaque reference tokens backed by server state, self-contained signed tokens, and the delegation protocols built on top.',
    whyItExists:
      'Proving identity is expensive and cannot be repeated on every request, so systems issue a credential that stands in for the proof — and every design decision follows from how much state backs that credential.',
    whenToUse: [
      'Server-side sessions for traditional web applications needing instant revocation and session enumeration.',
      'Short-lived JWTs plus an opaque refresh token for anything with many services or high request volume.',
      'OIDC whenever you need to know who a user is via a third party.',
    ],
    whenNotToUse: [
      'Long-lived stateless JWTs for user sessions — you have given up the ability to sign anyone out.',
      'OAuth2 access tokens as proof of identity; that is what the ID token is for.',
      'Confidential data in a JWT payload, which is readable by the client and by anything that logged it.',
    ],
    alternatives: [
      'Mutual TLS with short-lived workload certificates, for service-to-service identity without bearer tokens.',
      'Platform-attested identity (instance documents, service account tokens) to avoid configured long-lived secrets.',
      'Passkeys and WebAuthn for the authentication step itself, removing password handling entirely.',
    ],
    tradeoffs: [
      'Statelessness buys per-request scale and costs revocation.',
      'Short access-token lifetimes buy bounded revocation latency and cost refresh traffic plus client complexity.',
      'Refresh rotation buys theft detection and costs false positives when concurrent refreshes race.',
      'Claims in a token buy avoided lookups and cost staleness on every permission change.',
    ],
    failureModes: [
      'Algorithm confusion, where the header\'s alg is trusted and verification is bypassed.',
      'A missing audience check letting a token cross service boundaries.',
      'Tokens in localStorage exfiltrated by any XSS or a compromised dependency.',
      'Session fixation because the identifier was not rotated at login.',
      'Concurrent refresh races triggering reuse detection and signing out legitimate users.',
      'A stolen refresh token usable indefinitely because it is not rotated.',
      'Permission revocation not taking effect until token expiry.',
      'Long-lived shared secrets in service configuration, unrotated and unaudited.',
    ],
    followUpQuestions: [
      'How do you sign one user out right now, and what does that cost you?',
      'What does every service verify on a token, and who wrote that code?',
      'Which audience is this token for, and what happens if it reaches another service?',
      'What is the window between revoking a permission and it taking effect?',
      'Where did this service\'s credential come from?',
      'What happens when two tabs refresh at the same moment?',
    ],
  },
});
