export class ProductResponseDto {
  id: number;
  title: string;
  name: string;
  handle: string;
  slug: string;
  vendor: string;
  price: string;
  regularPrice: string | null;
  salePrice: string | null;
  compareAtPrice: string | null;
  image: string | null;
  imageUrl: string | null;
  images: string[];
  description: string;
  shortDescription: string;
  permalink: string | null;
  purchasable: boolean;
  stockStatus: string;
}
