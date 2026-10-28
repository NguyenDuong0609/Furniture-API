import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto.js';
import { UpdatePostDto } from './dto/update-post.dto.js';
import { GetPostsDto } from './dto/get-posts.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PostEntity } from './entities/post.entity.js';
import { Prisma } from '@prisma/client';
import { postWithAuthorInclude, userPublicSelect } from '../prisma/prisma-select.js';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPostDto: CreatePostDto, userId: number) {
    // const post = await this.prisma.post.create({
    //   data: {
    //     ...createPostDto,
    //     authorId: userId,
    //   },
    //   include: postWithAuthorInclude,
    // });

    // return new PostEntity(post);
  }

  async findAll(query: GetPostsDto) {
    // const { page = 1, limit = 10, search, published } = query;
    // const skip = (page - 1) * limit;

    // const where: Prisma.PostWhereInput = {};

    // if (search) {
    //   where.OR = [{ title: { contains: search } }, { content: { contains: search } }];
    // }

    // if (published !== undefined) {
    //   where.published = published;
    // }

    // const [posts, total] = await Promise.all([
    //   this.prisma.post.findMany({
    //     where,
    //     skip,
    //     take: limit,
    //     orderBy: { id: 'desc' },
    //     include: postWithAuthorInclude,
    //   }),
    //   this.prisma.post.count({ where }),
    // ]);

    // return {
    //   data: posts.map((post) => new PostEntity(post)),
    //   meta: {
    //     page,
    //     limit,
    //     total,
    //     totalPages: Math.ceil(total / limit),
    //   },
    // };
  }

  async findOne(id: number) {
    // const post = await this.prisma.post.findUnique({
    //   where: { id },
    //   include: postWithAuthorInclude,
    // });

    // if (!post) {
    //   throw new NotFoundException(`Không tìm thấy bài viết với id ${id}`);
    // }

    // return new PostEntity(post);
  }

  async update(id: number, updatePostDto: UpdatePostDto, userId: number) {
    // const post = await this.prisma.post.findUnique({ where: { id } });

    // if (!post) {
    //   throw new NotFoundException(`Không tìm thấy bài viết với id ${id}`);
    // }

    // // Chỉ cho phép tác giả sửa
    // if (post.authorId !== userId) {
    //   throw new ForbiddenException('Bạn không có quyền sửa bài viết này');
    // }

    // const updated = await this.prisma.post.update({
    //   where: { id },
    //   data: updatePostDto,
    //   include: postWithAuthorInclude,
    // });

    // return new PostEntity(updated);
  }

  async remove(id: number, userId: number) {
    // const post = await this.prisma.post.findUnique({
    //   where: { id },
    //   include: {
    //     author: {
    //       select: userPublicSelect, // <-- Sử dụng userPublicSelect ở đây nếu cần
    //     },
    //   },
    // });

    // if (!post) {
    //   throw new NotFoundException(`Không tìm thấy bài viết với id ${id}`);
    // }

    // // Chỉ cho phép tác giả xóa
    // if (post.authorId !== userId) {
    //   throw new ForbiddenException('Bạn không có quyền xóa bài viết này');
    // }

    // const deleted = await this.prisma.post.delete({
    //   where: { id },
    // });

    // return new PostEntity(deleted);
  }
}
