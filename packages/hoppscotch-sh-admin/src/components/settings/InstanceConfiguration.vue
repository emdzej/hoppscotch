<template>
  <div class="grid md:grid-cols-3 gap-8 md:gap-4 pt-8">
    <div class="md:col-span-1">
      <h3 class="heading">{{ t('configs.instance.title') }}</h3>
      <p class="my-1 text-secondaryLight">
        {{ t('configs.instance.description') }}
      </p>
    </div>

    <div class="space-y-6 sm:px-8 md:col-span-2">
      <!-- App display name -->
      <div>
        <label class="block font-semibold text-secondaryDark">
          {{ t('configs.instance.app_name') }}
        </label>
        <p class="my-1 text-tiny text-secondaryLight">
          {{ t('configs.instance.app_name_description') }}
        </p>
        <HoppSmartInput
          v-model="instanceConfigs.fields.app_display_name"
          :placeholder="t('configs.instance.app_name_placeholder')"
          :autofocus="false"
          class="!my-2 !bg-primaryLight max-w-lg"
          input-styles="!border border-divider rounded"
        />
      </div>

      <!-- Terms of Service link -->
      <div>
        <label class="block font-semibold text-secondaryDark">
          {{ t('configs.instance.tos_link') }}
        </label>
        <HoppSmartInput
          v-model="instanceConfigs.fields.app_tos_link"
          placeholder="https://example.com/terms"
          :autofocus="false"
          class="!my-2 !bg-primaryLight max-w-lg"
          :input-styles="
            isConfigFieldErrored('instance', 'app_tos_link')
              ? '!border border-red-500 rounded'
              : '!border border-divider rounded'
          "
        />
      </div>

      <!-- Privacy Policy link -->
      <div>
        <label class="block font-semibold text-secondaryDark">
          {{ t('configs.instance.privacy_link') }}
        </label>
        <HoppSmartInput
          v-model="instanceConfigs.fields.app_privacy_policy_link"
          placeholder="https://example.com/privacy"
          :autofocus="false"
          class="!my-2 !bg-primaryLight max-w-lg"
          :input-styles="
            isConfigFieldErrored('instance', 'app_privacy_policy_link')
              ? '!border border-red-500 rounded'
              : '!border border-divider rounded'
          "
        />
      </div>

      <!-- Require login toggle -->
      <div class="pt-2">
        <HoppSmartToggle
          :on="instanceConfigs.fields.enforce_login"
          @change="
            instanceConfigs.fields.enforce_login =
              !instanceConfigs.fields.enforce_login
          "
        >
          {{ t('configs.instance.enforce_login') }}
        </HoppSmartToggle>
        <p class="my-1 ml-12 text-tiny text-secondaryLight">
          {{ t('configs.instance.enforce_login_description') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVModel } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from '~/composables/i18n';
import { ServerConfigs, useConfigValidation } from '~/helpers/configs';

const t = useI18n();

const { isConfigFieldErrored } = useConfigValidation();

const props = defineProps<{
  config: ServerConfigs;
}>();

const emit = defineEmits<{
  (e: 'update:config', v: ServerConfigs): void;
}>();

const workingConfigs = useVModel(props, 'config', emit);

const instanceConfigs = computed({
  get() {
    return workingConfigs.value.instanceConfigs;
  },
  set(value) {
    workingConfigs.value.instanceConfigs = value;
  },
});
</script>
