import * as E from "fp-ts/Either"

type ProxyAppUrl = {
  value: string
  name: string
}

export type InfraPlatformDef = {
  getIsSMTPEnabled?: () => Promise<E.Either<string, boolean>>
  getProxyAppUrl?: () => Promise<E.Either<string, ProxyAppUrl>>
  /**
   * Whether the instance requires users to be logged in before the app UI is
   * shown. Read anonymously at boot. Implementations should fail open (resolve
   * `false`) on error so a transient failure never locks users out.
   */
  getEnforceLogin?: () => Promise<boolean>
}
