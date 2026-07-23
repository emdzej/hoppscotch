import { Strategy } from 'passport-openidconnect';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UserService } from 'src/user/user.service';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import { ConfigService } from '@nestjs/config';
import { validateEmail } from 'src/utils';
import { AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH } from 'src/errors';
import { StatelessStateStore } from '../stateless-state-store';

/**
 * Generic OpenID Connect (OIDC) login strategy.
 *
 * Unlike the Google/GitHub/Microsoft strategies (which target a single known
 * provider), this works with any spec-compliant OIDC provider — Keycloak,
 * Okta, Auth0, Authentik, Entra ID via generic OIDC, etc. The provider's
 * endpoints are supplied explicitly through infra-config so no discovery
 * round-trip is needed at boot. Copy them from the provider's
 * `/.well-known/openid-configuration` document.
 */
@Injectable()
export class OIDCStrategy extends PassportStrategy(Strategy, 'openidconnect', 9) {
  constructor(
    private authService: AuthService,
    private usersService: UserService,
    private configService: ConfigService,
  ) {
    super({
      issuer: configService.get<string>('INFRA.OIDC_ISSUER'),
      authorizationURL: configService.get<string>('INFRA.OIDC_AUTH_URL'),
      tokenURL: configService.get<string>('INFRA.OIDC_TOKEN_URL'),
      userInfoURL: configService.get<string>('INFRA.OIDC_USERINFO_URL'),
      clientID: configService.get<string>('INFRA.OIDC_CLIENT_ID'),
      clientSecret: configService.get<string>('INFRA.OIDC_CLIENT_SECRET'),
      callbackURL: configService.get<string>('INFRA.OIDC_CALLBACK_URL'),
      scope: configService.get<string>('INFRA.OIDC_SCOPE').split(','),
      store: new StatelessStateStore(
        configService.get<string>('INFRA.SESSION_SECRET'),
        undefined,
        (configService.get<string>('INFRA.SESSION_COOKIE_NAME') ||
          '__oauth_nonce') + '_oidc',
        configService.get<string>('INFRA.ALLOW_SECURE_COOKIES') === 'true',
      ),
    });
  }

  /**
   * We force callback arity 9 (via PassportStrategy's third arg) so
   * passport-openidconnect invokes verify with the fullest signature:
   *   (issuer, uiProfile, idProfile, context, idToken, accessToken,
   *    refreshToken, params, done)
   *
   * The default arity-3 form only yields the *parsed* profile (`Profile.parse`),
   * which drops non-standard claims. We need `uiProfile._json` — the raw
   * userinfo response — to read custom claims such as roles/groups.
   */
  async validate(
    issuer: string,
    uiProfile,
    idProfile,
    context,
    idToken,
    accessToken,
    refreshToken,
    params,
    done,
  ) {
    // Mirror passport's internal merge (userinfo precedence) so downstream
    // user.service methods find displayName/photos/emails/id as before.
    const profile = { ...(idProfile ?? {}), ...(uiProfile ?? {}) };

    // passport-openidconnect does not populate `profile.provider`; the account
    // table keys off (provider, providerAccountId), so set a stable value.
    profile.provider = 'openidconnect';

    const email = profile?.emails?.[0]?.value;

    if (!validateEmail(email))
      throw new UnauthorizedException(AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH);

    // Raw userinfo claims carry the custom claims (e.g. roles) that the parsed
    // profile drops. Resolve instance-admin status from them.
    // `null` means role mapping is not configured -> leave isAdmin untouched.
    const grantAdmin = this.resolveAdminFromRoles(uiProfile?._json ?? {});

    const user = await this.usersService.findUserByEmail(email);

    if (O.isNone(user)) {
      const createdUser = await this.usersService.createUserSSO(
        // OIDC access/refresh tokens are not needed post-login; store null.
        null,
        null,
        profile,
        grantAdmin === true,
      );
      return createdUser;
    }

    // Keep isAdmin in sync with the roles claim on every login (grant + revoke).
    if (grantAdmin !== null && user.value.isAdmin !== grantAdmin) {
      const synced = grantAdmin
        ? await this.usersService.makeAdmin(user.value.uid)
        : await this.usersService.removeUserAsAdmin(user.value.uid);
      if (E.isLeft(synced)) throw new UnauthorizedException(synced.left);
      user.value.isAdmin = grantAdmin;
    }

    /**
     * displayName and photoURL maybe null if user logged-in via magic-link before SSO
     */
    if (!user.value.displayName || !user.value.photoURL) {
      const updatedUser = await this.usersService.updateUserDetails(
        user.value,
        profile,
      );
      if (E.isLeft(updatedUser)) {
        throw new UnauthorizedException(updatedUser.left);
      }
    }

    /**
     * Check to see if entry for this OIDC provider is present in the Account
     * table for user. If user was created with another provider
     * findUserByEmail may return true.
     */
    const providerAccountExists =
      await this.authService.checkIfProviderAccountExists(user.value, profile);

    if (O.isNone(providerAccountExists))
      await this.usersService.createProviderAccount(
        user.value,
        null,
        null,
        profile,
      );

    return user.value;
  }

  /**
   * Determine instance-admin status from the provider's roles claim.
   *
   * Controlled by two infra-config values:
   *  - OIDC_ROLES_CLAIM: name (dot-path allowed, e.g. `realm_access.roles`) of
   *    the claim in the userinfo response that holds the user's roles/groups.
   *  - OIDC_ADMIN_ROLE:  the role value that grants admin (e.g. `hoppscotch.admin`).
   *
   * The roles claim must be present on the userinfo response (in Keycloak, add a
   * role/group protocol mapper with "Add to userinfo" enabled).
   *
   * @returns true/false when mapping is configured, or null when it is disabled
   *   (both config values must be set) so callers leave isAdmin untouched.
   */
  private resolveAdminFromRoles(claims): boolean | null {
    const rolesClaim = this.configService.get<string>('INFRA.OIDC_ROLES_CLAIM');
    const adminRole = this.configService.get<string>('INFRA.OIDC_ADMIN_ROLE');

    if (!rolesClaim || !adminRole) return null;

    const rawRoles = rolesClaim
      .split('.')
      .reduce((acc, key) => (acc == null ? undefined : acc[key]), claims);

    const roles = Array.isArray(rawRoles)
      ? rawRoles
      : rawRoles != null
        ? [rawRoles]
        : [];

    return roles.map((role) => `${role}`).includes(adminRole);
  }
}
