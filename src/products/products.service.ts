import { BadGatewayException, Injectable } from '@nestjs/common';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';
import { ProductResponseDto } from './dto/product-response.dto';

type WooCommerceProduct = {
  id: number;
  name: string;
  slug: string;
  price: string;
  regular_price?: string;
  sale_price?: string;
  description?: string;
  short_description?: string;
  permalink?: string;
  purchasable?: boolean;
  brands?: Array<{
    name?: string;
  }>;
  categories?: Array<{
    name?: string;
  }>;
  images?: Array<{
    src?: string;
  }>;
  stock_status: string;
};

@Injectable()
export class ProductsService {
  constructor(private readonly wooCommerceClient: WooCommerceClient) {}

  async findAll(): Promise<ProductResponseDto[]> {
    const products = await this.wooCommerceClient.get<WooCommerceProduct[]>(
      '/products',
      {
        params: {
          status: 'publish',
          per_page: 100,
        },
      },
    );

    if (!Array.isArray(products)) {
      throw new BadGatewayException({
        message:
          'WooCommerce products endpoint did not return a product list. Finish WooCommerce setup and configure REST API keys.',
        source: 'woocommerce',
      });
    }

    return products.map((product) => this.toProductResponseDto(product));
  }

  private toProductResponseDto(
    product: WooCommerceProduct,
  ): ProductResponseDto {
    return {
      id: product.id,
      title: product.name,
      name: product.name,
      handle: product.slug || String(product.id),
      slug: product.slug || String(product.id),
      vendor:
        product.brands?.[0]?.name ||
        product.categories?.[0]?.name ||
        'MelloRise',
      price: product.price || product.sale_price || product.regular_price || '0',
      regularPrice: product.regular_price || null,
      salePrice: product.sale_price || null,
      compareAtPrice: product.regular_price || null,
      image: product.images?.[0]?.src ?? null,
      imageUrl: product.images?.[0]?.src ?? null,
      images:
        product.images
          ?.map((image) => image.src)
          .filter((src): src is string => Boolean(src)) ?? [],
      description: product.description ?? '',
      shortDescription: product.short_description ?? '',
      permalink: product.permalink ?? null,
      purchasable: product.purchasable ?? true,
      stockStatus: product.stock_status,
    };
  }
}
