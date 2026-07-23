import { HttpStatus, Injectable } from '@nestjs/common';
import { MailerService } from 'src/mailer/mailer.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { VerifyMagicDto } from './dto/verify-magic.dto';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import { DeviceIdentifierToken } from 'src/types/Passwordless';
import {
  INVALID_EMAIL,
  INVALID_MAGIC_LINK_DATA,
  VERIFICATION_TOKEN_DATA_NOT_FOUND,
  MAGIC_LINK_EXPIRED,
  USER_NOT_FOUND,
  INVALID_REFRESH_TOKEN,
  OIDC_DISCOVERY_INVALID_ISSUER,
  OIDC_DISCOVERY_FAILED,
} from 'src/errors';
import { validateEmail } from 'src/utils';
import {
  AccessTokenPayload,
  AuthTokens,
  RefreshTokenPayload,
} from 'src/types/AuthTokens';
import { JwtService } from '@nestjs/jwt';
import { RESTError } from 'src/types/RESTError';
import { AuthUser, IsAdmin } from 'src/types/AuthUser';
import { VerificationToken } from 'src/generated/prisma/client';
import { AuthProvider, Origin } from './helper';
import { ConfigService } from '@nestjs/config';
import { InfraConfigService } from 'src/infra-config/infra-config.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly infraConfigService: InfraConfigService,
  ) {}

  /**
   * Generate Id and token for email Magic-Link auth
   *
   * @param user User Object
   * @returns Created VerificationToken token
   */
  private async generateMagicLinkTokens(user: AuthUser) {
    const salt = await bcrypt.genSalt(
      parseInt(this.configService.get('INFRA.TOKEN_SALT_COMPLEXITY')),
    );

    // Calculate expiration time by adding hours to current time
    let validityInHours = parseInt(
      this.configService.get('INFRA.MAGIC_LINK_TOKEN_VALIDITY'),
    );
    if (isNaN(validityInHours)) validityInHours = 24; // Default: 24 hours

    const expiresOn = new Date();
    expiresOn.setHours(expiresOn.getHours() + validityInHours);

    const idToken = await this.prisma.verificationToken.create({
      data: {
        deviceIdentifier: salt,
        userUid: user.uid,
        expiresOn: expiresOn,
      },
    });

    return idToken;
  }

  /**
   * Check if VerificationToken exist or not
   *
   * @param magicLinkTokens Object containing deviceIdentifier and token
   * @returns Option of VerificationToken token
   */
  private async validatePasswordlessTokens(magicLinkTokens: VerifyMagicDto) {
    try {
      const tokens = await this.prisma.verificationToken.findUniqueOrThrow({
        where: {
          passwordless_deviceIdentifier_tokens: {
            deviceIdentifier: magicLinkTokens.deviceIdentifier,
            token: magicLinkTokens.token,
          },
        },
      });
      return O.some(tokens);
    } catch (error) {
      return O.none;
    }
  }

  /**
   * Generate new refresh token for user
   *
   * @param userUid User Id
   * @returns Generated refreshToken
   */
  private async generateRefreshToken(userUid: string) {
    const refreshTokenPayload: RefreshTokenPayload = {
      iss: this.configService.get('VITE_BASE_URL'),
      sub: userUid,
      aud: [this.configService.get('VITE_BASE_URL')],
    };

    const refreshToken = await this.jwtService.sign(refreshTokenPayload, {
      expiresIn: this.configService.get('INFRA.REFRESH_TOKEN_VALIDITY'), //7 Days
    });

    const refreshTokenHash = await argon2.hash(refreshToken);

    const updatedUser = await this.usersService.updateUserRefreshToken(
      refreshTokenHash,
      userUid,
    );
    if (E.isLeft(updatedUser))
      return E.left(<RESTError>{
        message: updatedUser.left,
        statusCode: HttpStatus.NOT_FOUND,
      });

    return E.right(refreshToken);
  }

  /**
   * Generate access and refresh token pair
   *
   * @param userUid User ID
   * @returns Either of generated AuthTokens
   */
  async generateAuthTokens(userUid: string) {
    const accessTokenPayload: AccessTokenPayload = {
      iss: this.configService.get('VITE_BASE_URL'),
      sub: userUid,
      aud: [this.configService.get('VITE_BASE_URL')],
    };

    const refreshToken = await this.generateRefreshToken(userUid);
    if (E.isLeft(refreshToken)) return E.left(refreshToken.left);

    return E.right(<AuthTokens>{
      access_token: await this.jwtService.sign(accessTokenPayload, {
        expiresIn: this.configService.get('INFRA.ACCESS_TOKEN_VALIDITY'), //1 Day
      }),
      refresh_token: refreshToken.right,
    });
  }

  /**
   * Deleted used VerificationToken tokens
   *
   * @param passwordlessTokens VerificationToken entry to delete from DB
   * @returns Either of deleted VerificationToken token
   */
  private async deleteMagicLinkVerificationTokens(
    passwordlessTokens: VerificationToken,
  ) {
    try {
      const deletedPasswordlessToken =
        await this.prisma.verificationToken.delete({
          where: {
            passwordless_deviceIdentifier_tokens: {
              deviceIdentifier: passwordlessTokens.deviceIdentifier,
              token: passwordlessTokens.token,
            },
          },
        });
      return E.right(deletedPasswordlessToken);
    } catch (error) {
      return E.left(VERIFICATION_TOKEN_DATA_NOT_FOUND);
    }
  }

  /**
   * Verify if Provider account exists for User
   *
   * @param user User Object
   * @param SSOUserData User data from SSO providers (Magic,Google,Github,Microsoft)
   * @returns Either of existing user provider Account
   */
  async checkIfProviderAccountExists(user: AuthUser, SSOUserData) {
    const provider = await this.prisma.account.findUnique({
      where: {
        verifyProviderAccount: {
          provider: SSOUserData.provider,
          providerAccountId: SSOUserData.id,
        },
      },
    });

    if (!provider) return O.none;

    return O.some(provider);
  }

  /**
   * Create User (if not already present) and send email to initiate Magic-Link auth
   *
   * @param email User's email
   * @returns Either containing DeviceIdentifierToken
   */
  async signInMagicLink(email: string, origin: string) {
    if (!validateEmail(email))
      return E.left({
        message: INVALID_EMAIL,
        statusCode: HttpStatus.BAD_REQUEST,
      });

    let user: AuthUser;
    const queriedUser = await this.usersService.findUserByEmail(email);

    if (O.isNone(queriedUser)) {
      user = await this.usersService.createUserViaMagicLink(email);
    } else {
      user = queriedUser.value;
    }

    const generatedTokens = await this.generateMagicLinkTokens(user);

    // check to see if origin is valid
    let url: string;
    switch (origin) {
      case Origin.ADMIN:
        url = this.configService.get('VITE_ADMIN_URL');
        break;
      case Origin.APP:
        url = this.configService.get('VITE_BASE_URL');
        break;
      default:
        // if origin is invalid by default set URL to Hoppscotch-App
        url = this.configService.get('VITE_BASE_URL');
    }

    await this.mailerService.sendEmail(email, {
      template: 'user-invitation',
      variables: {
        inviteeEmail: email,
        magicLink: `${url}/enter?token=${generatedTokens.token}`,
      },
    });

    return E.right(<DeviceIdentifierToken>{
      deviceIdentifier: generatedTokens.deviceIdentifier,
    });
  }

  /**
   * Verify and authenticate user from received data for Magic-Link
   *
   * @param magicLinkIDTokens magic-link verification tokens from client
   * @returns Either of generated AuthTokens
   */
  async verifyMagicLinkTokens(
    magicLinkIDTokens: VerifyMagicDto,
  ): Promise<E.Right<AuthTokens> | E.Left<RESTError>> {
    const passwordlessTokens =
      await this.validatePasswordlessTokens(magicLinkIDTokens);
    if (O.isNone(passwordlessTokens))
      return E.left({
        message: INVALID_MAGIC_LINK_DATA,
        statusCode: HttpStatus.NOT_FOUND,
      });

    const user = await this.usersService.findUserById(
      passwordlessTokens.value.userUid,
    );
    if (O.isNone(user))
      return E.left({
        message: USER_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });

    /**
     * * Check to see if entry for Magic-Link is present in the Account table for user
     * * If user was created with another provider findUserById may return true
     */
    const profile = {
      provider: 'magic',
      id: user.value.email,
    };
    const providerAccountExists = await this.checkIfProviderAccountExists(
      user.value,
      profile,
    );

    if (O.isNone(providerAccountExists)) {
      await this.usersService.createProviderAccount(
        user.value,
        null,
        null,
        profile,
      );
    }

    const currentTime = new Date();
    if (currentTime > passwordlessTokens.value.expiresOn)
      return E.left({
        message: MAGIC_LINK_EXPIRED,
        statusCode: HttpStatus.UNAUTHORIZED,
      });

    const tokens = await this.generateAuthTokens(
      passwordlessTokens.value.userUid,
    );
    if (E.isLeft(tokens))
      return E.left({
        message: tokens.left.message,
        statusCode: tokens.left.statusCode,
      });

    const deletedPasswordlessToken =
      await this.deleteMagicLinkVerificationTokens(passwordlessTokens.value);
    if (E.isLeft(deletedPasswordlessToken))
      return E.left({
        message: deletedPasswordlessToken.left,
        statusCode: HttpStatus.NOT_FOUND,
      });

    this.usersService.updateUserLastLoggedOn(passwordlessTokens.value.userUid);

    return E.right(tokens.right);
  }

  /**
   * Refresh refresh and auth tokens
   *
   * @param hashedRefreshToken Hashed refresh token received from client
   * @param user User Object
   * @returns Either of generated AuthTokens
   */
  async refreshAuthTokens(hashedRefreshToken: string, user: AuthUser) {
    // Check to see user is valid
    if (!user)
      return E.left({
        message: USER_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });

    // Check to see if the hashed refresh_token received from the client is the same as the refresh_token saved in the DB
    const isTokenMatched = await argon2.verify(
      user.refreshToken,
      hashedRefreshToken,
    );
    if (!isTokenMatched)
      return E.left({
        message: INVALID_REFRESH_TOKEN,
        statusCode: HttpStatus.NOT_FOUND,
      });

    // if tokens match, generate new pair of auth tokens
    const generatedAuthTokens = await this.generateAuthTokens(user.uid);
    if (E.isLeft(generatedAuthTokens))
      return E.left({
        message: generatedAuthTokens.left.message,
        statusCode: generatedAuthTokens.left.statusCode,
      });

    return E.right(generatedAuthTokens.right);
  }

  /**
   * Verify is signed in User is an admin or not
   *
   * @param user User Object
   * @returns Either of boolean if user is admin or not
   */
  async verifyAdmin(user: AuthUser) {
    if (user.isAdmin) return E.right(<IsAdmin>{ isAdmin: true });

    // When OIDC role-to-admin mapping is configured, admin status is owned by
    // the provider's roles claim (synced on every login). Skip the legacy
    // "first user is auto-admin" elevation so it can't override the mapping.
    const oidcRoleMappingEnabled =
      !!this.configService.get<string>('INFRA.OIDC_ROLES_CLAIM') &&
      !!this.configService.get<string>('INFRA.OIDC_ADMIN_ROLE');

    const usersCount = await this.usersService.getUsersCount();
    if (!oidcRoleMappingEnabled && usersCount === 1) {
      const elevatedUser = await this.usersService.makeAdmin(user.uid);
      if (E.isLeft(elevatedUser))
        return E.left(<RESTError>{
          message: elevatedUser.left,
          statusCode: HttpStatus.NOT_FOUND,
        });

      return E.right(<IsAdmin>{ isAdmin: true });
    }

    return E.right(<IsAdmin>{ isAdmin: false });
  }

  getAuthProviders() {
    const providers = this.infraConfigService.getAllowedAuthProviders();

    // Decorate the generic OIDC entry as `OIDC:<name>` so the login UI can
    // label the button with the provider's display name. The stored
    // VITE_ALLOWED_AUTH_PROVIDERS value stays the bare `OIDC` used by guards.
    const oidcName = this.configService.get<string>('INFRA.OIDC_PROVIDER_NAME');
    if (oidcName) {
      return providers.map((provider) =>
        provider === AuthProvider.OIDC
          ? `${AuthProvider.OIDC}:${oidcName}`
          : provider,
      );
    }

    return providers;
  }

  /**
   * Fetch an OIDC provider's `.well-known/openid-configuration` discovery
   * document and return the endpoints the admin would otherwise have to enter
   * by hand. Used by the admin auth-settings form and the onboarding wizard so
   * they only need the issuer URL.
   *
   * The fetch runs server-side (the browser can't read the IdP's document
   * cross-origin), so this is a small SSRF surface: to limit it we only accept
   * http(s) issuers, block loopback / link-local / metadata hosts, cap the
   * response, time out quickly, and return ONLY the parsed OIDC endpoint fields
   * — never the raw upstream body.
   */
  async discoverOidcConfiguration(issuer: string): Promise<
    E.Either<
      typeof OIDC_DISCOVERY_INVALID_ISSUER | typeof OIDC_DISCOVERY_FAILED,
      {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        userinfo_endpoint: string;
        scopes_supported?: string[];
      }
    >
  > {
    let issuerUrl: URL;
    try {
      issuerUrl = new URL(issuer);
    } catch {
      return E.left(OIDC_DISCOVERY_INVALID_ISSUER);
    }

    if (issuerUrl.protocol !== 'https:' && issuerUrl.protocol !== 'http:') {
      return E.left(OIDC_DISCOVERY_INVALID_ISSUER);
    }

    if (this.isBlockedDiscoveryHost(issuerUrl.hostname)) {
      return E.left(OIDC_DISCOVERY_INVALID_ISSUER);
    }

    // Per OIDC Discovery, the document lives at
    // `{issuer-with-no-trailing-slash}/.well-known/openid-configuration`.
    const wellKnownUrl = `${issuerUrl.href.replace(/\/+$/, '')}/.well-known/openid-configuration`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(wellKnownUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      });

      if (!res.ok) return E.left(OIDC_DISCOVERY_FAILED);

      // Cap the body so a hostile/misconfigured endpoint can't stream us
      // unbounded data.
      const text = await res.text();
      if (text.length > 1_000_000) return E.left(OIDC_DISCOVERY_FAILED);

      const doc = JSON.parse(text);

      const authorization_endpoint = doc.authorization_endpoint;
      const token_endpoint = doc.token_endpoint;
      const userinfo_endpoint = doc.userinfo_endpoint;

      if (
        typeof authorization_endpoint !== 'string' ||
        typeof token_endpoint !== 'string' ||
        typeof userinfo_endpoint !== 'string'
      ) {
        return E.left(OIDC_DISCOVERY_FAILED);
      }

      return E.right({
        // Prefer the issuer the document declares (may be normalized), falling
        // back to what the admin typed.
        issuer: typeof doc.issuer === 'string' ? doc.issuer : issuer,
        authorization_endpoint,
        token_endpoint,
        userinfo_endpoint,
        scopes_supported: Array.isArray(doc.scopes_supported)
          ? doc.scopes_supported.filter((s: unknown) => typeof s === 'string')
          : undefined,
      });
    } catch {
      return E.left(OIDC_DISCOVERY_FAILED);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Best-effort denylist for OIDC discovery targets. Blocks loopback,
   * link-local (incl. cloud metadata 169.254.169.254), and obvious internal
   * hostnames by literal match. This is defense-in-depth, not airtight — it
   * does not resolve DNS, so a hostname pointing at a private IP is not caught.
   */
  private isBlockedDiscoveryHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost') ||
      host === 'metadata.google.internal'
    ) {
      return true;
    }

    // IPv4 private / loopback / link-local ranges.
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      if (a === 127 || a === 10) return true;
      if (a === 169 && b === 254) return true; // link-local incl. metadata
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
    }

    return false;
  }
}
