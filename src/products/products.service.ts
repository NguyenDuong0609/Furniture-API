import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { GetProductsDto } from './dto/get-products.dto.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async create(dto: CreateProductDto) {
    // Kiểm tra slug trùng
    const existingSlug = await this.prisma.product.findUnique({
      where: { slug: dto.slug },
    });
    if (existingSlug) {
      throw new ConflictException('Slug sản phẩm đã tồn tại');
    }

    // Kiểm tra category
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    // Kiểm tra brand nếu có
    if (dto.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: dto.brandId },
      });
      if (!brand) {
        throw new NotFoundException('Thương hiệu không tồn tại');
      }
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        price: dto.price,
        salePrice: dto.salePrice,
        sku: dto.sku,
        stock: dto.stock ?? 0,
        isActive: dto.isActive ?? true,
        isFeatured: dto.isFeatured ?? false,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        images: dto.images
          ? {
              create: dto.images.map((img) => ({
                url: img.url,
                alt: img.alt,
                isMain: img.isMain ?? false,
                sortOrder: img.sortOrder ?? 0,
              })),
            }
          : undefined,
        variants: dto.variants
          ? {
              create: dto.variants.map((v) => ({
                name: v.name,
                sku: v.sku,
                price: v.price,
                stock: v.stock ?? 0,
                attributes: v.attributes ? JSON.stringify(v.attributes) : null,
              })),
            }
          : undefined,
      },
      include: {
        images: true,
        variants: true,
        category: true,
        brand: true,
      },
    });
  }

  async findAll(query: GetProductsDto) {
    const {
      page = 1,
      limit = 12,
      search,
      categoryId,
      categorySlug,
      brandId,
      isFeatured,
      isActive = true,
      minPrice,
      maxPrice,
      sortBy = 'newest',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      isActive,
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (categorySlug) {
      where.category = { slug: categorySlug };
    }

    if (brandId) {
      where.brandId = brandId;
    }

    if (isFeatured !== undefined) {
      where.isFeatured = isFeatured;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    if (sortBy === 'price_asc') orderBy = { price: 'asc' };
    if (sortBy === 'price_desc') orderBy = { price: 'desc' };
    if (sortBy === 'name') orderBy = { name: 'asc' };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          images: {
            orderBy: { sortOrder: 'asc' },
          },
          category: {
            select: { id: true, name: true, slug: true },
          },
          brand: {
            select: { id: true, name: true, slug: true },
          },
          variants: true,
          _count: {
            select: { reviews: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Parse attributes JSON
    const data = products.map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({
        ...v,
        attributes: v.attributes ? JSON.parse(v.attributes) : null,
      })),
    }));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: true,
        category: true,
        brand: true,
        reviews: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm với id ${id}`);
    }

    return {
      ...product,
      variants: product.variants.map((v) => ({
        ...v,
        attributes: v.attributes ? JSON.parse(v.attributes) : null,
      })),
    };
  }

  async findBySlug(slug: string) {
    const cacheKey = `product:slug:${slug}`;

    // Lấy từ cache
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: true,
        category: true,
        brand: true,
        reviews: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm với slug ${slug}`);
    }

    // Lưu cache 5 phút
    await this.cacheManager.set(cacheKey, product, 5 * 60 * 1000);

    return {
      ...product,
      variants: product.variants.map((v) => ({
        ...v,
        attributes: v.attributes ? JSON.parse(v.attributes) : null,
      })),
    };
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id);

    if (dto.slug) {
      const existing = await this.prisma.product.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException('Slug đã tồn tại');
      }
    }

    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: {
        images: true,
        variants: true,
        category: true,
        brand: true,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.product.delete({ where: { id } });
  }
}