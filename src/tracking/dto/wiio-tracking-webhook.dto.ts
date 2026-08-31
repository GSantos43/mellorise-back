import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class WiioTrackingWebhookDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  orderId?: number;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsString()
  @IsNotEmpty()
  trackingCode: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  trackingUrl?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  shippedAt?: string;
}
