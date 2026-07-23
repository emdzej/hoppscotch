import { useHead } from "@unhead/vue"
import { createHead } from "@unhead/vue/client"
import { computed } from "vue"

import { APP_INFO } from "~/../meta"
import { siteConfig } from "@composables/site-config"
import { HoppModule } from "."

export default <HoppModule>{
  onVueAppInit(app) {
    const head = createHead()

    app.use(head)
  },

  onRootSetup() {
    // Prefer the instance-configured app name; fall back to the build-time brand.
    const appName = computed(() => siteConfig.appName || APP_INFO.name)

    useHead({
      title: computed(() => `${appName.value} • ${APP_INFO.shortDescription}`),
      titleTemplate(title) {
        return title === appName.value || title === APP_INFO.name
          ? appName.value
          : `${title} • ${appName.value}`
      },
    })
  },
}
