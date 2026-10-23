import { Module } from '@nestjs/common';
import {
  AccountsController,
  CustomersController,
} from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  controllers: [CustomersController, AccountsController],
  providers: [CustomersService],
})
export class CustomersModule {}
