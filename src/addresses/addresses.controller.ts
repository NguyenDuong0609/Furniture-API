import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AddressesService } from './addresses.service.js';
import { ActiveUser } from '../shared/decorators/active-user.decorator.js';

@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  create(@ActiveUser('id') userId: number, @Body() body: any) {
    return this.addressesService.create(userId, body);
  }

  @Get()
  findAll(@ActiveUser('id') userId: number) {
    return this.addressesService.findAll(userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @ActiveUser('id') userId: number, @Body() body: any) {
    return this.addressesService.update(+id, userId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveUser('id') userId: number) {
    return this.addressesService.remove(+id, userId);
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string, @ActiveUser('id') userId: number) {
    return this.addressesService.setDefault(+id, userId);
  }
}