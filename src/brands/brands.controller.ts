import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BrandsService } from './brands.service.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../shared/decorators/permissions.decorator.js';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:create')
  create(@Body() body: { name: string; slug: string; logo?: string }) {
    return this.brandsService.create(body);
  }

  @Public()
  @Get()
  findAll() {
    return this.brandsService.findAll();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:update')
  update(@Param('id') id: string, @Body() body: any) {
    return this.brandsService.update(+id, body);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:delete')
  remove(@Param('id') id: string) {
    return this.brandsService.remove(+id);
  }
}