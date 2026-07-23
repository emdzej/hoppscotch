# Self-Hosting: Authentication & Access

This fork adds three self-host authentication/access features to the community
backend, on top of the built-in Google / GitHub / Microsoft / email providers:

1. [Generic OIDC login](#generic-oidc-login)
2. [OIDC role → instance admin mapping](#oidc-role--instance-admin-mapping)
3. [Require login to access the app](#require-login-to-access-the-app)

All settings are stored in the `InfraConfig` table (the same store the admin
dashboard uses). You can set them via the admin dashboard, seed them in the DB,
or provide them through your deployment's infra-config mechanism. Values take
effect on backend restart.

---

## Generic OIDC login

Adds a spec-compliant OpenID Connect login provider (via
[`passport-openidconnect`](https://www.npmjs.com/package/passport-openidconnect)),
so any OIDC identity provider — Keycloak, Okta, Auth0, Authentik, Entra ID via
generic OIDC, etc. — can be used to sign in. Endpoints are supplied explicitly
(no discovery round-trip at boot); copy them from your provider's
`/.well-known/openid-configuration` document.

### Configuration keys

| Key | Required | Description |
|-----|----------|-------------|
| `OIDC_ISSUER` | ✅ | Issuer identifier. **Must match the `iss` claim exactly** — usually **no trailing slash** (e.g. `https://idp.example.com/realms/acme`). |
| `OIDC_AUTH_URL` | ✅ | `authorization_endpoint` |
| `OIDC_TOKEN_URL` | ✅ | `token_endpoint` |
| `OIDC_USERINFO_URL` | ✅ | `userinfo_endpoint` |
| `OIDC_CLIENT_ID` | ✅ | Client ID (stored encrypted) |
| `OIDC_CLIENT_SECRET` | ✅ | Client secret (stored encrypted) — the client must be **confidential** |
| `OIDC_CALLBACK_URL` | ✅ | `<VITE_BACKEND_API_URL>/auth/oidc/callback` (e.g. `https://api.example.com/v1/auth/oidc/callback`) |
| `OIDC_SCOPE` | ✅ | Comma-separated scopes, e.g. `profile,email` (`openid` is added automatically) |
| `OIDC_PROVIDER_NAME` | optional | Display name for the login button (`Continue with <name>`). |

Then add `OIDC` to `VITE_ALLOWED_AUTH_PROVIDERS` (comma-separated), e.g.
`VITE_ALLOWED_AUTH_PROVIDERS=OIDC` or `EMAIL,OIDC`.

### Identity-provider setup

On the IdP side, register a client with:

- **Client authentication / confidential** enabled (there is a client secret).
- **Standard flow / authorization code** enabled.
- **Valid redirect URI** = the `OIDC_CALLBACK_URL` above.
- Users must have an **email** (login fails without one).

The `OIDC_CALLBACK_URL` path is self-healing: if you change
`VITE_BACKEND_API_URL`, the backend rewrites the callback URL to
`<backend>/auth/oidc/callback` on startup.

### Notes & gotchas

- **Issuer trailing slash:** `OIDC_ISSUER` is matched against the token's `iss`
  claim by exact string. Keycloak (and most IdPs) emit the issuer **without** a
  trailing slash — copy the exact `issuer` value from the discovery document.
- **Scope:** `openid` is prepended automatically; list only the extras
  (`profile,email`).
- Login creates a normal `User` and an `Account` row
  (`provider = openidconnect`, `providerAccountId = <sub>`).

---

## OIDC role → instance admin mapping

Grants instance-admin (`User.isAdmin`) based on a role/group claim from the
provider. When configured, admin status is **fully synced on every login**
(granted when the role is present, revoked when it is not).

### Configuration keys

| Key | Description |
|-----|-------------|
| `OIDC_ROLES_CLAIM` | Name of the claim holding the user's roles/groups. Dot-paths are supported (e.g. `roles` or `realm_access.roles`). |
| `OIDC_ADMIN_ROLE` | The role value that grants admin (e.g. `hoppscotch.admin`). |

Both must be set for mapping to be active. Example: with `OIDC_ROLES_CLAIM=roles`
and `OIDC_ADMIN_ROLE=hoppscotch.admin`, a user whose userinfo contains
`"roles": ["hoppscotch.admin"]` becomes an admin.

### Important: the claim must be in the **userinfo** response

Admin resolution reads the provider's **userinfo** response. Many IdPs put roles
only in the access/ID token by default. In **Keycloak**, add a protocol mapper
(a *User Realm Role* or *Group Membership* mapper) with **"Add to userinfo"
enabled**, and a token claim name matching `OIDC_ROLES_CLAIM`.

### Interaction with first-user auto-admin

The community backend auto-promotes the first user to admin. When role mapping
is enabled, that shortcut is **disabled** so the roles claim is the single
source of truth.

> ⚠️ Because mapping is a full sync, a misconfigured claim or renamed role can
> revoke admin from everyone. Verify the userinfo claim shape before relying on
> it (log in once and confirm the role appears in userinfo).

---

## Require login to access the app

When enabled, the web app renders **only the login screen** until the user is
authenticated (no anonymous workspace access), similar to the admin dashboard.

| Key | Description |
|-----|-------------|
| `ENFORCE_LOGIN` | `true` to gate the whole app behind login; `false` (default) keeps anonymous, local-first use. |

The flag is exposed to the frontend through a public endpoint,
`GET /v1/site/config`, which returns `{ "enforceLogin": boolean }`. The gate
**fails open**: if the config can't be fetched, the app does not lock users out.
