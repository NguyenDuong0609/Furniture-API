import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { PostsService } from './posts.service.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import { UpdatePostDto } from './dto/update-post.dto.js';
import { LoggingInterceptor } from '../shared/logging.interceptor.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { ActiveUser, type ActiveUserData } from '../shared/decorators/active-user.decorator.js';
import { GetPostsDto } from './dto/get-posts.dto.js';

@Controller('posts')
@UseInterceptors(LoggingInterceptor)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  // create(@Body() createPostDto: CreatePostDto) {
  //   return this.postsService.create(createPostDto);
  // }
  create(@Body() createPostDto: CreatePostDto, @ActiveUser('id') userId: number) {
    return this.postsService.create(createPostDto, userId);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetPostsDto) {
    return this.postsService.findAll(query);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePostDto: UpdatePostDto,
    @ActiveUser('id') userId: number,
  ) {
    return this.postsService.update(+id, updatePostDto, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveUser('id') userId: number) {
    return this.postsService.remove(+id, userId);
  }
}
