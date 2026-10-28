import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    // Kiểm tra slug trùng
    const existing = await this.prisma.category.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('Slug đã tồn tại');
    }

    // Kiểm tra parentId nếu có
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('Danh mục cha không tồn tại');
      }
    }

    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        image: dto.image || null,
        parentId: dto.parentId || null,
      },
    });
  }

  async findAll() {
    return this.prisma.category.findMany({
      where: { parentId: null }, // chỉ lấy danh mục gốc
      include: {
        children: {
          include: {
            children: true, // hỗ trợ 2-3 cấp
          },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        parent: true,
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Không tìm thấy danh mục với id ${id}`);
    }

    return category;
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        children: true,
        parent: true,
        products: {
          where: { isActive: true },
          take: 20,
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Không tìm thấy danh mục với slug ${slug}`);
    }

    return category;
  }

  async update(id: number, dto: UpdateCategoryDto) {
    await this.findOne(id);

    if (dto.slug) {
      const existing = await this.prisma.category.findFirst({
        where: {
          slug: dto.slug,
          NOT: { id },
        },
      });
      if (existing) {
        throw new ConflictException('Slug đã tồn tại');
      }
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...dto,
        image: dto.image === '' ? null : dto.image,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    // Kiểm tra còn sản phẩm không
    const productCount = await this.prisma.product.count({
      where: { categoryId: id },
    });
    if (productCount > 0) {
      throw new ConflictException(
        'Không thể xóa danh mục đang chứa sản phẩm',
      );
    }

    return this.prisma.category.delete({
      where: { id },
    });
  }
}