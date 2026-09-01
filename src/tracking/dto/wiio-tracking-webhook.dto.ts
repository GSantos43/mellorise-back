import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class WiioTrackingWebhookDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  orderId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  order_id?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  wooOrderId?: number;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsOptional()
  @IsString()
  order_number?: string;

  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsString()
  trackingCode?: string;

  @IsOptional()
  @IsString()
  tracking_code?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  tracking_number?: string;

  @IsOptional()
  @IsString()
  trackNumber?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  logisticName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  trackingUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  tracking_url?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  trackUrl?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  orderStatus?: string;

  @IsOptional()
  @IsString()
  shippedAt?: string;

  @IsOptional()
  @IsString()
  shipped_at?: string;
}
