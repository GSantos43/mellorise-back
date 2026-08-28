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

type WooCommerceStoreProduct = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  short_description?: string;
  permalink?: string;
  brands?: Array<{
    name?: string;
  }>;
  categories?: Array<{
    name?: string;
  }>;
  images?: Array<{
    src?: string;
  }>;
  prices?: {
    price?: string;
    regular_price?: string;
    sale_price?: string;
    currency_minor_unit?: number;
  };
  variation?: string;
  variations?: Array<{
    id: number;
    attributes?: Array<{
      name?: string;
      value?: string;
    }>;
  }>;
  is_purchasable?: boolean;
  is_in_stock?: boolean;
};

type WooCommerceStoreVariation = WooCommerceStoreProduct & {
  parent: number;
};

type WooCommerceStoreProductVariationSummary = NonNullable<
  WooCommerceStoreProduct['variations']
>[number];

@Injectable()
export class ProductsService {
  constructor(private readonly wooCommerceClient: WooCommerceClient) {}

  async findAll(): Promise<ProductResponseDto[]> {
    const products = await this.wooCommerceClient.getStore<WooCommerceStoreProduct[]>(
      '/products',
      {
        params: {
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

    return Promise.all(
      products.map((product) => this.toStoreProductResponseDto(product)),
    );
  }

  private toProductResponseDto(
    product: WooCommerceProduct,
  ): ProductResponseDto {
    return {
      id: product.id,
      title: this.decodeHtmlEntities(product.name),
      name: this.decodeHtmlEntities(product.name),
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

  private async toStoreProductResponseDto(
    product: WooCommerceStoreProduct,
  ): Promise<ProductResponseDto> {
    const title = this.decodeHtmlEntities(product.name);
    const price = this.fromMinorUnitPrice(
      product.prices?.price,
      product.prices?.currency_minor_unit,
    );
    const regularPrice = this.fromMinorUnitPrice(
      product.prices?.regular_price,
      product.prices?.currency_minor_unit,
    );
    const salePrice = this.fromMinorUnitPrice(
      product.prices?.sale_price,
      product.prices?.currency_minor_unit,
    );
    const images =
      product.images
        ?.map((image) => image.src)
        .filter((src): src is string => Boolean(src)) ?? [];
    const variants = await this.findStoreProductVariants(product);

    return {
      id: product.id,
      title,
      name: title,
      handle: product.slug || String(product.id),
      slug: product.slug || String(product.id),
      vendor:
        product.brands?.[0]?.name ||
        product.categories?.[0]?.name ||
        'MelloRise',
      price: price || salePrice || regularPrice || '0',
      regularPrice: regularPrice || null,
      salePrice: salePrice || null,
      compareAtPrice:
        regularPrice && regularPrice !== price && regularPrice !== '0'
          ? regularPrice
          : null,
      image: images[0] ?? null,
      imageUrl: images[0] ?? null,
      images,
      description: product.description ?? '',
      shortDescription: product.short_description ?? '',
      permalink: product.permalink ?? null,
      purchasable: product.is_purchasable ?? true,
      stockStatus: product.is_in_stock === false ? 'outofstock' : 'instock',
      variants,
    };
  }

  private async findStoreProductVariants(
    product: WooCommerceStoreProduct,
  ): Promise<ProductResponseDto['variants']> {
    if (!product.variations?.length) return [];

    const variations = await Promise.all(
      product.variations.map((variation) =>
        this.wooCommerceClient.getStore<WooCommerceStoreVariation>(
          `/products/${variation.id}`,
        ),
      ),
    );

    return variations.map((variation, index) => {
      const price = this.fromMinorUnitPrice(
        variation.prices?.price,
        variation.prices?.currency_minor_unit,
      );
      const regularPrice = this.fromMinorUnitPrice(
        variation.prices?.regular_price,
        variation.prices?.currency_minor_unit,
      );
      const salePrice = this.fromMinorUnitPrice(
        variation.prices?.sale_price,
        variation.prices?.currency_minor_unit,
      );
      const title =
        this.getVariationTitle(variation) ||
        this.getVariationAttributeValue(product.variations?.[index]) ||
        `Variation ${variation.id}`;

      return {
        id: variation.id,
        title,
        price: price || salePrice || regularPrice || '0',
        regularPrice: regularPrice || null,
        salePrice: salePrice || null,
        compareAtPrice:
          regularPrice && regularPrice !== price && regularPrice !== '0'
            ? regularPrice
            : null,
        purchasable: variation.is_purchasable ?? true,
        stockStatus:
          variation.is_in_stock === false ? 'outofstock' : 'instock',
      };
    });
  }

  private getVariationTitle(variation: WooCommerceStoreVariation): string {
    const rawTitle =
      variation.variation?.split(':').pop()?.trim() ||
      variation.name?.split(' - ').pop()?.trim() ||
      '';

    return this.decodeHtmlEntities(rawTitle);
  }

  private getVariationAttributeValue(
    variation: WooCommerceStoreProductVariationSummary | undefined,
  ): string {
    const rawValue = variation?.attributes?.[0]?.value ?? '';
    return this.decodeHtmlEntities(rawValue);
  }

  private fromMinorUnitPrice(
    value: string | undefined,
    minorUnit = 2,
  ): string {
    if (!value) return '';

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;

    return String(numeric / 10 ** minorUnit);
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&#(\d+);/g, (_, code: string) =>
        String.fromCharCode(Number(code)),
      )
      .replace(/&amp;|&#038;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
}
