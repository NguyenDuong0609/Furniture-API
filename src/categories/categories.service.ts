import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

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
    const cacheKey = 'categories:all';

    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

    const categories = await this.prisma.category.findMany({
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

    await this.cacheManager.set(cacheKey, categories, 10 * 60 * 1000); // 10 phút

    return categories;
  }

  async findOne(id: number) {
    const cacheKey = `category:id:${id}`;

    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

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

    await this.cacheManager.set(cacheKey, category, 10 * 60 * 1000); // 10 phút

    return category;
  }

  async findBySlug(slug: string) {
    const cacheKey = `category:slug:${slug}`;

    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

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

    await this.cacheManager.set(cacheKey, category, 10 * 60 * 1000); // 10 phút

    return category;
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const oldCategory = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!oldCategory) {
      throw new NotFoundException(`Không tìm thấy danh mục với id ${id}`);
    }

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

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...dto,
        image: dto.image === '' ? null : dto.image,
      },
    });

    // Clear cache
    await this.cacheManager.del(`category:id:${id}`);
    await this.cacheManager.del(`category:slug:${oldCategory.slug}`);
    if (dto.slug) {
      await this.cacheManager.del(`category:slug:${dto.slug}`);
    }
    await this.cacheManager.del('categories:all');

    return updated;
  }

  async remove(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Không tìm thấy danh mục với id ${id}`);
    }

    // Kiểm tra còn sản phẩm không
    const productCount = await this.prisma.product.count({
      where: { categoryId: id },
    });
    if (productCount > 0) {
      throw new ConflictException(
        'Không thể xóa danh mục đang chứa sản phẩm',
      );
    }

    const deleted = await this.prisma.category.delete({
      where: { id },
    });

    // Clear cache
    await this.cacheManager.del(`category:id:${id}`);
    await this.cacheManager.del(`category:slug:${category.slug}`);
    await this.cacheManager.del('categories:all');

    return deleted;
  }
}