import { Body, Controller, Get, Post, Req, UseGuards, Patch } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { ApiKeyGuard } from './guards/api-key.guard.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { LogoutDto } from './dto/logout.dto.js';
import { ActiveUser, type ActiveUserData } from '../shared/decorators/active-user.decorator.js';
import { Verify2FADto } from './dto/verify-2fa.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // chỉ 3 lần / phút
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

@Patch('profile')
updateProfile(
  @ActiveUser('id') userId: number,
  @Body() dto: UpdateProfileDto,
) {
  return this.authService.updateProfile(userId, dto);
}

@Post('change-password')
changePassword(
  @ActiveUser('id') userId: number,
  @Body() dto: ChangePasswordDto,
) {
  return this.authService.changePassword(userId, dto);
}

  @Post('2fa/generate')
generate2FA(@ActiveUser('id') userId: number) {
  return this.authService.generateTwoFactorSecret(userId);
}

@Post('2fa/enable')
enable2FA(
  @ActiveUser('id') userId: number,
  @Body() dto: Verify2FADto,
) {
  return this.authService.enableTwoFactor(userId, dto.token);
}

@Post('2fa/disable')
disable2FA(
  @ActiveUser('id') userId: number,
  @Body() dto: Verify2FADto,
) {
  return this.authService.disableTwoFactor(userId, dto.token);
}

  @Public()
  @Post('logout')
  logout(@Body() logoutDto: LogoutDto) {
    return this.authService.logout(logoutDto);
  }

  @UseGuards(JwtAuthGuard) // hoặc bỏ vì đã global
  @Post('logout-all')
  // logoutAll(@Req() req: any) {
  //   return this.authService.logoutAll(req.user.id);
  // }
  @Post('logout-all')
  logoutAll(@ActiveUser('id') userId: number) {
    return this.authService.logoutAll(userId);
  }

  @Public()
  @Post('refresh-token')
  refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  @Public()
  @Post('verify-token')
  verifyToken(@Body('accessToken') accessToken: string) {
    return this.authService.verifyAccessToken(accessToken);
  }

  // @Get('profile')
  // getProfile(@ActiveUser() user: ActiveUserData) {
  //   return {
  //     message: 'Lấy thông tin profile thành công',
  //     user,
  //   };
  // }

    @Get('profile')
  getProfile(@ActiveUser('id') userId: number) {
    return this.authService.getProfile(userId);
  }

  // Ví dụ lấy từng field
  @Get('profile/email')
  getEmail(@ActiveUser('email') email: string) {
    return {
      email,
    };
  }

  @Get('profile/id')
  getUserId(@ActiveUser('id') userId: number) {
    return {
      userId,
    };
  }

  // Route được bảo vệ bởi JWT Guard
  // @UseGuards(JwtAuthGuard)
  // @Get('profile')
  // getProfile(@Req() req: any) {
  //   return {
  //     message: 'Lấy thông tin profile thành công',
  //     user: req.user,
  //   };
  // }

  // Route chỉ cho phép truy cập bằng API Key
  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('internal-data')
  getInternalData() {
    return {
      message: 'Đây là dữ liệu nội bộ chỉ truy cập được bằng API Key',
      secretData: {
        totalUsers: 100,
        systemStatus: 'healthy',
      },
    };
  }
}
