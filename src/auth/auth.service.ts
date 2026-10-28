import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { HashingService } from '../shared/hashing.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { UserEntity } from './entities/user.entity.js';
import { randomUUID } from 'crypto';
import { isError, isString, isJwtPayload } from '../shared/utils/type-guards.js';
import { LogoutDto } from './dto/logout.dto.js';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const hashedPassword = await this.hashingService.hash(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    return {
      message: 'Đăng ký thành công',
      user: new UserEntity(user),
    };
  }

  // async login(loginDto: LoginDto) {
  //   const { email, password } = loginDto;

  //   const user = await this.prisma.user.findUnique({
  //     where: { email },
  //   });

  //   if (!user) {
  //     throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
  //   }

  //   const isPasswordValid = await this.hashingService.compare(password, user.password);

  //   if (!isPasswordValid) {
  //     throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
  //   }

  //   const tokens = await this.generateTokens(user.id, user.email);

  //   return {
  //     message: 'Đăng nhập thành công',
  //     ...tokens,
  //     user: new UserEntity(user),
  //   };
  // }

  async login(loginDto: LoginDto | any) {  // tạm thời any, sau dùng Login2FADto
  const { email, password, token } = loginDto;

  const user = await this.prisma.user.findUnique({ where: { email } });
  if (!user) {
    // throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    // test i18n
    throw new UnauthorizedException(this.i18n.t('common.auth.invalid_credentials'),);
  }

  const isPasswordValid = await this.hashingService.compare(password, user.password);
  if (!isPasswordValid) {
    throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
  }

  // Nếu user đã bật 2FA
  if (user.isTwoFactorEnabled) {
    if (!token) {
      // Trả về yêu cầu nhập mã 2FA (chưa cấp token)
      return {
        message: 'Yêu cầu mã xác thực 2 lớp',
        requires2FA: true,
        // không trả accessToken
      };
    }

    if (!user.twoFactorSecret) {
      throw new UnauthorizedException('Chưa cấu hình mã xác thực 2FA');
    }

    const result = await verify({
      token,
      secret: user.twoFactorSecret,
    });

    if (!result.valid) {
      // throw new UnauthorizedException('Mã 2FA không đúng');
      // test i18n
      throw new UnauthorizedException(this.i18n.t('common.auth.invalid_2fa'),);
    }
  }

  // Tạo token bình thường
  const tokens = await this.generateTokens(user.id, user.email);

  // return {
  //   message: 'Đăng nhập thành công',
  //   ...tokens,
  //   user: new UserEntity(user),
  // };
  // test i18n
  return {
    message: this.i18n.t('common.auth.login_success'),
    ...tokens,
    user: new UserEntity(user),
  };
}

  async logout(logoutDto: LogoutDto) {
    const { refreshToken } = logoutDto;

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!storedToken) {
      // Không tiết lộ token có tồn tại hay không (bảo mật)
      return {
        message: 'Đăng xuất thành công',
      };
    }

    // Xóa refresh token khỏi database
    await this.prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });

    return {
      message: 'Đăng xuất thành công',
    };
  }

  async logoutAll(userId: number) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return {
      message: 'Đã đăng xuất khỏi tất cả thiết bị',
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    // Tìm refresh token trong database
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    // Kiểm tra hết hạn
    if (new Date() > storedToken.expiresAt) {
      // Xóa token hết hạn
      await this.prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });
      throw new UnauthorizedException('Refresh token đã hết hạn');
    }

    // Xóa refresh token cũ (rotation)
    await this.prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });

    // Tạo cặp token mới
    const tokens = await this.generateTokens(storedToken.user.id, storedToken.user.email);

    return {
      message: 'Làm mới token thành công',
      ...tokens,
    };
  }

  async verifyAccessToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (!isJwtPayload(payload)) {
        throw new UnauthorizedException('Token không hợp lệ');
      }

      // Đến đây TypeScript biết payload là JwtPayload
      return {
        userId: payload.sub,
        email: payload.email,
      };
    } catch (error) {
      throw new UnauthorizedException(this.extractErrorMessage(error));
    }
  }

  /**
 * Tạo secret + QR code để user bật 2FA
 */
async generateTwoFactorSecret(userId: number) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedException();

  const secret = generateSecret();
  const otpauthUrl = generateURI({
    label: user.email,
    issuer: 'NestJS Furniture Shop',
    secret,
  });

  // Lưu secret tạm (chưa enable)
  await this.prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return {
    secret,
    qrCode: qrCodeDataUrl, // frontend hiển thị QR này
  };
}

/**
 * Xác nhận mã 2FA lần đầu → chính thức bật 2FA
 */
async enableTwoFactor(userId: number, token: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorSecret) {
    throw new BadRequestException('Chưa tạo secret 2FA');
  }

  const result = await verify({
    token,
    secret: user.twoFactorSecret,
  });

  if (!result.valid) {
    throw new UnauthorizedException('Mã 2FA không đúng');
  }

  await this.prisma.user.update({
    where: { id: userId },
    data: { isTwoFactorEnabled: true },
  });

  return { message: 'Đã bật xác thực 2 lớp thành công' };
}

/**
 * Tắt 2FA
 */
async disableTwoFactor(userId: number, token: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
    throw new BadRequestException('2FA chưa được bật');
  }

  const result = await verify({
    token,
    secret: user.twoFactorSecret,
  });

  if (!result.valid) {
    throw new UnauthorizedException('Mã 2FA không đúng');
  }

  await this.prisma.user.update({
    where: { id: userId },
    data: {
      isTwoFactorEnabled: false,
      twoFactorSecret: null,
    },
  });

  return { message: 'Đã tắt xác thực 2 lớp' };
}

async getProfile(userId: number) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      avatar: true,
      isTwoFactorEnabled: true,
      createdAt: true,
      updatedAt: true,
      roles: {
        include: {
          role: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundException('Không tìm thấy người dùng');
  }

  return {
    ...user,
    roles: user.roles.map((ur) => ur.role),
  };
}

async updateProfile(userId: number, dto: UpdateProfileDto) {
  const user = await this.prisma.user.update({
    where: { id: userId },
    data: {
      name: dto.name,
      phone: dto.phone,
      avatar: dto.avatar,
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      avatar: true,
      isTwoFactorEnabled: true,
      updatedAt: true,
    },
  });

  return {
    message: 'Cập nhật thông tin thành công',
    user,
  };
}

async changePassword(userId: number, dto: ChangePasswordDto) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundException('Không tìm thấy người dùng');
  }

  const isValid = await this.hashingService.compare(
    dto.currentPassword,
    user.password,
  );

  if (!isValid) {
    throw new UnauthorizedException('Mật khẩu hiện tại không đúng');
  }

  const hashed = await this.hashingService.hash(dto.newPassword);

  await this.prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  // Xóa toàn bộ refresh token (bắt buộc login lại)
  await this.prisma.refreshToken.deleteMany({
    where: { userId },
  });

  return {
    message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
  };
}

  private async generateTokens(userId: number, email: string) {
    const payload = { sub: userId, email };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_EXPIRES_IN') || '1h') as any, // Thêm as any ở đây
    });

    // Tạo refresh token (dùng UUID + lưu DB)
    const refreshToken = randomUUID();

    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const expiresAt = new Date();

    // Tính ngày hết hạn (đơn giản: 7 ngày)
    const days = parseInt(refreshExpiresIn) || 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Ví dụ sử dụng Type Predicate
   */
  private extractErrorMessage(error: unknown): string {
    if (isError(error)) {
      // TypeScript biết error là Error → có thể dùng error.message
      return error.message;
    }

    if (isString(error)) {
      return error;
    }

    return 'Đã xảy ra lỗi không xác định';
  }
}
