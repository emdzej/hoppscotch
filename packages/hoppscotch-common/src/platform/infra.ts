import * as E from "fp-ts/Either"

type ProxyAppUrl = {
  value: string
  name: string
}

export type SiteConfig = {
  /** Require login before the app UI is shown (gate anonymous access). */
  enforceLogin: boolean
  /** Instance display name (e.g. shown as "Login to <appName>"). */
  appName: string | null
  /** Terms of Service URL for this instance. */
  tosLink: string | null
  /** Privacy Policy URL for this instance. */
  privacyPolicyLink: string | null
}

export type InfraPlatformDef = {
  getIsSMTPEnabled?: () => Promise<E.Either<string, boolean>>
  getProxyAppUrl?: () => Promise<E.Either<string, ProxyAppUrl>>
  /**
   * Public, runtime instance configuration read anonymously at boot.
   * Implementations should fail open (return safe defaults) on error so a
   * transient failure never locks users out.
   */
  getSiteConfig?: () => Promise<SiteConfig>
}
