import { reactive } from "vue"
import { platform } from "~/platform"

const DEFAULT_APP_NAME = "Hoppscotch"

/**
 * Reactive, instance-level public configuration (branding + access rules)
 * fetched once at app boot from the backend's public `/site/config` endpoint.
 *
 * Values fall back to build-time env / sensible defaults so the UI renders
 * correctly before the fetch resolves and if it fails.
 */
export const siteConfig = reactive({
  loaded: false,
  enforceLogin: false,
  appName: DEFAULT_APP_NAME,
  tosLink: (import.meta.env.VITE_APP_TOS_LINK as string) ?? "",
  privacyPolicyLink:
    (import.meta.env.VITE_APP_PRIVACY_POLICY_LINK as string) ?? "",
})

let loadPromise: Promise<void> | null = null

/**
 * Fetches site config once (subsequent calls return the same promise).
 * Only non-empty backend values override the defaults.
 */
export function loadSiteConfig(): Promise<void> {
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const cfg = await platform.infra?.getSiteConfig?.()

    if (cfg) {
      siteConfig.enforceLogin = cfg.enforceLogin ?? false
      if (cfg.appName) siteConfig.appName = cfg.appName
      if (cfg.tosLink) siteConfig.tosLink = cfg.tosLink
      if (cfg.privacyPolicyLink)
        siteConfig.privacyPolicyLink = cfg.privacyPolicyLink
    }

    siteConfig.loaded = true
  })()

  return loadPromise
}
