<template>
  <div v-if="workingConfigs" class="grid md:grid-cols-3 gap-8 md:gap-4 pt-8">
    <div class="md:col-span-1">
      <h3 class="heading">{{ t('configs.auth_providers.title') }}</h3>
      <p class="my-1 text-secondaryLight">
        {{ t('configs.auth_providers.description') }}
      </p>
    </div>

    <div class="space-y-8 sm:px-8 md:col-span-2">
      <section>
        <h4 class="font-semibold text-secondaryDark">
          {{ t('configs.auth_providers.title') }}
        </h4>

        <div
          v-for="provider in workingConfigs.providers"
          class="space-y-4 py-4"
        >
          <div class="flex justify-between">
            <HoppSmartToggle
              :on="provider.enabled"
              @change="provider.enabled = !provider.enabled"
            >
              {{ providerLabel(provider.name) }}
            </HoppSmartToggle>
            <HoppButtonSecondary
              v-tippy="{ theme: 'tooltip', allowHTML: true }"
              to="https://docs.hoppscotch.io/documentation/self-host/community-edition/prerequisites#oauth"
              blank
              :title="t('support.documentation')"
              :icon="IconCircleHelp"
              class="rounded hover:bg-primaryDark focus-visible:bg-primaryDark"
            />
          </div>

          <div v-if="provider.enabled" class="ml-12">
            <div
              v-for="field in providerConfigFields"
              :key="field.key"
              class="mt-5"
            >
              <template
                v-if="field.applicableProviders.includes(provider.name)"
              >
                <label>{{ makeReadableKey(field.name, true) }}</label>
                <span class="flex max-w-lg">
                  <HoppSmartInput
                    v-model="provider.fields[field.key as keyof typeof provider['fields']]"
                    :type="
                      isMaskable(field.key) && isMasked(provider.name, field.key)
                        ? 'password'
                        : 'text'
                    "
                    :autofocus="false"
                    class="!my-2 !bg-primaryLight flex-1 border border-divider rounded"
                    :class="{
                      '!border-red-500': isConfigFieldErrored(
                        provider.name,
                        field.key,
                      ),
                    }"
                    input-styles="!border-0"
                  >
                    <template #button v-if="isMaskable(field.key)">
                      <HoppButtonSecondary
                        :icon="
                          isMasked(provider.name, field.key)
                            ? IconEye
                            : IconEyeOff
                        "
                        class="bg-primaryLight rounded"
                        @click="toggleMask(provider.name, field.key)"
                      />
                    </template>
                  </HoppSmartInput>
                  <HoppButtonSecondary
                    v-if="provider.name === 'oidc' && field.key === 'issuer'"
                    v-tippy="{ theme: 'tooltip' }"
                    :label="t('configs.auth_providers.discover')"
                    :title="t('configs.auth_providers.discover_hint')"
                    :loading="discovering"
                    filled
                    outline
                    class="!my-2 ml-2 rounded"
                    @click="discover(provider)"
                  />
                </span>
              </template>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVModel } from '@vueuse/core';
import { reactive, ref } from 'vue';
import { useI18n } from '~/composables/i18n';
import { useToast } from '~/composables/toast';
import { auth } from '~/helpers/auth';
import {
  ServerConfigs,
  SsoAuthProviders,
  useConfigValidation,
} from '~/helpers/configs';
import { makeReadableKey } from '~/helpers/utils/readableKey';
import IconCircleHelp from '~icons/lucide/circle-help';
import IconEye from '~icons/lucide/eye';
import IconEyeOff from '~icons/lucide/eye-off';

const t = useI18n();
const toast = useToast();

const { isConfigFieldErrored } = useConfigValidation();

const discovering = ref(false);

// Fetch the OIDC provider's `.well-known/openid-configuration` from the issuer
// and fill the auth / token / userinfo endpoint fields.
const discover = async (
  provider: ServerConfigs['providers'][SsoAuthProviders]
): Promise<void> => {
  const fields = provider.fields as Record<string, string>;
  const issuer = fields.issuer?.trim();
  if (!issuer) {
    toast.error(t('configs.auth_providers.issuer_required'));
    return;
  }

  discovering.value = true;
  try {
    const doc = await auth.discoverOidcConfig(issuer);
    fields.auth_url = doc.authorization_endpoint;
    fields.token_url = doc.token_endpoint;
    fields.user_info_url = doc.userinfo_endpoint;
    toast.success(t('configs.auth_providers.discover_success'));
  } catch (err) {
    console.error('OIDC discovery failed', err);
    toast.error(t('configs.auth_providers.discover_failed'));
  } finally {
    discovering.value = false;
  }
};

const props = defineProps<{
  config: ServerConfigs;
}>();

const emit = defineEmits<{
  (e: 'update:config', v: ServerConfigs): void;
}>();

const workingConfigs = useVModel(props, 'config', emit);

// Capitalize first letter of a string
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

// Display label for a provider toggle (acronyms stay uppercased).
const providerLabel = (name: string) =>
  name === 'oidc' ? 'OIDC' : capitalize(name);

// Union type for all possible field keys
type ProviderFieldKeys = keyof ProviderFields;

type ProviderFields = Partial<{
  [Field in keyof ServerConfigs['providers'][SsoAuthProviders]['fields']]: boolean;
}> &
  Partial<{
    tenant: boolean;
    provider_name: boolean;
    issuer: boolean;
    auth_url: boolean;
    token_url: boolean;
    user_info_url: boolean;
    roles_claim: boolean;
    admin_role: boolean;
  }>;

type ProviderFieldMetadata = {
  name: string;
  key: ProviderFieldKeys;
  applicableProviders: SsoAuthProviders[];
};

const providerConfigFields = <ProviderFieldMetadata[]>[
  // OIDC-only connection fields (rendered first for OIDC).
  {
    name: t('configs.auth_providers.provider_name'),
    key: 'provider_name',
    applicableProviders: ['oidc'],
  },
  {
    name: t('configs.auth_providers.issuer'),
    key: 'issuer',
    applicableProviders: ['oidc'],
  },
  {
    name: t('configs.auth_providers.auth_url'),
    key: 'auth_url',
    applicableProviders: ['oidc'],
  },
  {
    name: t('configs.auth_providers.token_url'),
    key: 'token_url',
    applicableProviders: ['oidc'],
  },
  {
    name: t('configs.auth_providers.user_info_url'),
    key: 'user_info_url',
    applicableProviders: ['oidc'],
  },
  {
    name: t('configs.auth_providers.client_id'),
    key: 'client_id',
    applicableProviders: ['google', 'github', 'microsoft', 'oidc'],
  },
  {
    name: t('configs.auth_providers.client_secret'),
    key: 'client_secret',
    applicableProviders: ['google', 'github', 'microsoft', 'oidc'],
  },
  {
    name: t('configs.auth_providers.callback_url'),
    key: 'callback_url',
    applicableProviders: ['google', 'github', 'microsoft', 'oidc'],
  },
  {
    name: t('configs.auth_providers.scope'),
    key: 'scope',
    applicableProviders: ['google', 'github', 'microsoft', 'oidc'],
  },
  {
    name: t('configs.auth_providers.tenant'),
    key: 'tenant',
    applicableProviders: ['microsoft'],
  },
  // OIDC role -> instance-admin mapping (optional).
  {
    name: t('configs.auth_providers.roles_claim'),
    key: 'roles_claim',
    applicableProviders: ['oidc'],
  },
  {
    name: t('configs.auth_providers.admin_role'),
    key: 'admin_role',
    applicableProviders: ['oidc'],
  },
];

// Only genuinely secret fields get password-masking and a reveal toggle.
// Everything else — issuer/endpoint URLs, client_id (public in OAuth2), scope,
// tenant, roles_claim, admin_role — renders as plain text so admins can read
// and verify them. Previously every field defaulted to masked, which made the
// OIDC URL fields render as password inputs.
const MASKABLE_FIELDS = new Set<ProviderFieldKeys>(['client_secret']);

const isMaskable = (fieldKey: ProviderFieldKeys) =>
  MASKABLE_FIELDS.has(fieldKey);

const maskState = reactive<Record<SsoAuthProviders, ProviderFields>>({
  google: { client_secret: true },
  github: { client_secret: true },
  microsoft: { client_secret: true },
  oidc: { client_secret: true },
});

const toggleMask = (
  provider: SsoAuthProviders,
  fieldKey: ProviderFieldKeys
) => {
  maskState[provider][fieldKey] = !maskState[provider][fieldKey];
};

const isMasked = (provider: SsoAuthProviders, fieldKey: ProviderFieldKeys) =>
  maskState[provider][fieldKey];
</script>
