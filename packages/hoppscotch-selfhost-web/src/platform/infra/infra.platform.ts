import { runGQLQuery } from "@hoppscotch/common/helpers/backend/GQLClient"
import { InfraPlatformDef } from "@hoppscotch/common/platform/infra"
import {
  GetProxyAppUrlDocument,
  GetSmtpStatusDocument,
} from "@app/api/generated/graphql"
import * as E from "fp-ts/Either"
import axios from "axios"

const getSMTPStatus = () => {
  return runGQLQuery({
    query: GetSmtpStatusDocument,
    variables: {},
  })
}

const getProxyAppUrl = () => {
  return runGQLQuery({
    query: GetProxyAppUrlDocument,
    variables: {},
  })
}

export const InfraPlatform: InfraPlatformDef = {
  getIsSMTPEnabled: async () => {
    const res = await getSMTPStatus()

    if (E.isRight(res)) {
      return E.right(res.right.isSMTPEnabled)
    }

    return E.left("SMTP_STATUS_FETCH_FAILED")
  },
  getProxyAppUrl: async () => {
    const res = await getProxyAppUrl()

    if (E.isRight(res)) {
      return E.right(res.right.proxyAppUrl)
    }

    return E.left("PROXY_APP_URL_FETCH_FAILED")
  },
  getSiteConfig: async () => {
    // Public, unauthenticated endpoint. Fail open so a transient error never
    // locks users out of the app.
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BACKEND_API_URL}/site/config`,
        { withCredentials: true }
      )
      return {
        enforceLogin: res.data?.enforceLogin === true,
        appName: res.data?.appName ?? null,
        tosLink: res.data?.tosLink ?? null,
        privacyPolicyLink: res.data?.privacyPolicyLink ?? null,
      }
    } catch (e) {
      console.error("Failed to fetch site config", e)
      return {
        enforceLogin: false,
        appName: null,
        tosLink: null,
        privacyPolicyLink: null,
      }
    }
  },
}
