import { Controller, Get } from '@nestjs/common';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(): Promise<ProductResponseDto[]> {
    return this.productsService.findAll();
  }
}
