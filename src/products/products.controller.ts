import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { GetProductsDto } from './dto/get-products.dto.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../shared/decorators/permissions.decorator.js';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) { }

  @ApiBearerAuth('access-token')
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:create')
  @ApiBearerAuth('access-token')
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách sản phẩm (có filter + phân trang)' })
  findAll(@Query() query: GetProductsDto) {
    return this.productsService.findAll(query);
  }

  @Public()
  @Get(':id/related')
  related(@Param('id') id: string) {
    return this.productsService.findRelated(+id);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(+id);
  }

  @Public()
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:update')
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(+id, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:delete')
  remove(@Param('id') id: string) {
    return this.productsService.remove(+id);
  }
}