import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  async create(data: { name: string; slug: string; logo?: string }) {
    const exists = await this.prisma.brand.findUnique({ where: { slug: data.slug } });
    if (exists) throw new ConflictException('Slug đã tồn tại');
    return this.prisma.brand.create({ data });
  }

  findAll() {
    return this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: number) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundException('Không tìm thấy thương hiệu');
    return brand;
  }

  async update(id: number, data: Partial<{ name: string; slug: string; logo: string }>) {
    await this.findOne(id);
    return this.prisma.brand.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.brand.delete({ where: { id } });
  }
}