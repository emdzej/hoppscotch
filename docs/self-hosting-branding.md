# Self-Hosting: Branding & Instance Config

This fork lets a self-hosted instance override its display name and legal links
at runtime, without rebuilding the frontend. Settings live in the `InfraConfig`
table (set them via the admin dashboard, DB, or your infra-config mechanism) and
take effect on backend restart / app reload.

They are exposed to the (anonymous) frontend through the public endpoint
`GET /v1/site/config`:

```jsonc
{
  "enforceLogin": false,
  "appName": "Acme API",
  "tosLink": "https://acme.example/terms",
  "privacyPolicyLink": "https://acme.example/privacy"
}
```

## Configuration keys

| Key | Description | Fallback |
|-----|-------------|----------|
| `APP_DISPLAY_NAME` | Instance display name. | `Hoppscotch` |
| `APP_TOS_LINK` | Terms of Service URL. | build-time `VITE_APP_TOS_LINK` |
| `APP_PRIVACY_POLICY_LINK` | Privacy Policy URL. | build-time `VITE_APP_PRIVACY_POLICY_LINK` |

### Where the app name appears

`APP_DISPLAY_NAME` drives every place the brand is shown as **text**:

- The login screen title — "Login to `<appName>`".
- The header brand label (top-left of the app shell).
- The browser tab title — "`<page>` • `<appName>`".

The admin dashboard login shows the configured ToS / Privacy links too.

> **No logo asset:** the web app shell has no logo *image* to replace — the
> header brand is a text label — so there is intentionally no logo-URL setting.
> Branding is name + legal links only.

## Notes

- Values fall back to sensible defaults, so an unset key leaves the default
  Hoppscotch branding/links in place.
- `APP_TOS_LINK` / `APP_PRIVACY_POLICY_LINK` are validated as URLs when set
  (empty is allowed).
- The links default to seeding from the build-time `VITE_APP_TOS_LINK` /
  `VITE_APP_PRIVACY_POLICY_LINK` env vars on first setup, then can be overridden
  at runtime.
