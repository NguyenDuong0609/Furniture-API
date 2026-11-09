import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  create(userId: number, data: any) {
    return this.prisma.address.create({
      data: { ...data, userId },
    });
  }

  findAll(userId: number) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
    });
  }

  async update(id: number, userId: number, data: any) {
    const addr = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!addr) throw new NotFoundException('Không tìm thấy địa chỉ');
    return this.prisma.address.update({ where: { id }, data });
  }

  async remove(id: number, userId: number) {
    const addr = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!addr) throw new NotFoundException('Không tìm thấy địa chỉ');
    await this.prisma.address.delete({ where: { id } });
    return { message: 'Đã xóa địa chỉ' };
  }

  async setDefault(id: number, userId: number) {
    await this.prisma.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
    return this.prisma.address.update({
      where: { id },
      data: { isDefault: true },
    });
  }
}