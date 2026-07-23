<template>
  <div>
    <div
      v-if="isLoadingInitialRoute || !isGateResolved"
      class="flex min-h-screen flex-col items-center justify-center"
    >
      <HoppSmartSpinner />
    </div>
    <template v-else>
      <ErrorPage v-if="errorInfo !== null" :error="errorInfo" />
      <!-- When the instance enforces login, gate the whole app UI behind the
           login screen until a user is authenticated. -->
      <FirebaseLogin
        v-else-if="loginGateActive"
        :key="gateKey"
        @hide-modal="onGateDismissAttempt"
      />
      <RouterView v-else />
    </template>
    <Toaster rich-colors />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import ErrorPage, { ErrorPageData } from "~/pages/_.vue"
import { HOPP_MODULES } from "@modules/."
import { isLoadingInitialRoute } from "@modules/router"
import { useI18n } from "@composables/i18n"
import { APP_IS_IN_DEV_MODE } from "@helpers/dev"
import { platform } from "./platform"
import { Toaster } from "@hoppscotch/ui"
import { Subscription } from "rxjs"

const t = useI18n()

const errorInfo = ref<ErrorPageData | null>(null)

// --- Enforce-login gate ---------------------------------------------------
// If the instance requires login, render only the login screen until a user
// is authenticated. Anonymous use stays the default when the flag is off.
const enforceLogin = ref(false)
const isGateResolved = ref(false)
const currentUser = ref(platform.auth.getCurrentUser())

let currentUserSub: Subscription | null = null

onMounted(() => {
  currentUserSub = platform.auth
    .getCurrentUserStream()
    .subscribe((user) => (currentUser.value = user))
})

onUnmounted(() => currentUserSub?.unsubscribe())

// Resolve the flag before rendering anything (fails open to false).
;(async () => {
  try {
    enforceLogin.value = (await platform.infra?.getEnforceLogin?.()) ?? false
  } finally {
    isGateResolved.value = true
  }
})()

const loginGateActive = computed(() => enforceLogin.value && !currentUser.value)

// FirebaseLogin is a dismissible modal; when gating we force it to stay by
// remounting on any dismiss attempt.
const gateKey = ref(0)
const onGateDismissAttempt = () => {
  gateKey.value++
}

// App Crash Handler
// If the below code gets more complicated, move this onto a module
const formatErrorMessage = (err: Error | null | undefined) => {
  if (!err) return null
  return `${err.name}: ${err.message}`
}

// App Crash Handler is only a thing in Dev Mode
if (APP_IS_IN_DEV_MODE) {
  window.onerror = (_, _1, _2, _3, err) => {
    errorInfo.value = {
      statusCode: 500,
      message: formatErrorMessage(err) ?? t("error.something_went_wrong"),
    }

    // Returning false here will not cancel the error and will log it to console
    return false
  }
}

// Run module root component setup code
HOPP_MODULES.forEach((mod) => mod.onRootSetup?.())
platform.addedHoppModules?.forEach((mod) => mod.onRootSetup?.())
</script>
