import { Controller, Get, HttpStatus, Put, UseGuards } from '@nestjs/common';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { InfraConfigService } from './infra-config.service';
import * as E from 'fp-ts/Either';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RESTAdminGuard } from 'src/admin/guards/rest-admin.guard';
import { RESTError } from 'src/types/RESTError';
import { InfraConfigEnum } from 'src/types/InfraConfig';
import { throwHTTPErr } from 'src/utils';

@UseGuards(ThrottlerBehindProxyGuard)
@Controller({ path: 'site', version: '1' })
export class SiteController {
  constructor(private infraConfigService: InfraConfigService) {}

  @Get('setup')
  @UseGuards(JwtAuthGuard, RESTAdminGuard)
  async fetchSetupInfo() {
    const status = await this.infraConfigService.get(
      InfraConfigEnum.IS_FIRST_TIME_INFRA_SETUP,
    );

    if (E.isLeft(status))
      throwHTTPErr(<RESTError>{
        message: status.left,
        statusCode: HttpStatus.NOT_FOUND,
      });
    return status.right;
  }

  /**
   * Public site configuration readable by anonymous visitors (rate-limited
   * only). Used by the web app at boot to decide whether to gate the UI
   * behind login.
   */
  @Get('config')
  async fetchPublicConfig() {
    const read = async (key: InfraConfigEnum) => {
      const res = await this.infraConfigService.get(key);
      return E.isRight(res) ? res.right.value : null;
    };

    return {
      enforceLogin: (await read(InfraConfigEnum.ENFORCE_LOGIN)) === 'true',
      appName: await read(InfraConfigEnum.APP_DISPLAY_NAME),
      tosLink: await read(InfraConfigEnum.APP_TOS_LINK),
      privacyPolicyLink: await read(InfraConfigEnum.APP_PRIVACY_POLICY_LINK),
    };
  }

  @Put('setup')
  @UseGuards(JwtAuthGuard, RESTAdminGuard)
  async setSetupAsComplete() {
    const res = await this.infraConfigService.update(
      InfraConfigEnum.IS_FIRST_TIME_INFRA_SETUP,
      false.toString(),
      false,
    );

    if (E.isLeft(res))
      throwHTTPErr(<RESTError>{
        message: res.left,
        statusCode: HttpStatus.FORBIDDEN,
      });
    return res.right;
  }
}
