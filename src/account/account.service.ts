import { Injectable } from '@nestjs/common';
import { AuthenticatedClerkCustomer } from '../auth/clerk-auth.service';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';

type WooCommerceAccountOrder = {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  total?: string;
  date_created?: string;
  date_modified?: string;
  billing?: {
    email?: string;
  };
  line_items?: Array<{
    name?: string;
    quantity?: number;
    total?: string;
    image?: {
      src?: string;
    };
  }>;
  meta_data?: Array<{
    key?: string;
    value?: unknown;
  }>;
};

@Injectable()
export class AccountService {
  constructor(private readonly wooCommerceClient: WooCommerceClient) {}

  async listOrdersForCustomer(customer: AuthenticatedClerkCustomer) {
    const orders = await this.wooCommerceClient.get<WooCommerceAccountOrder[]>('/orders', {
      params: {
        search: customer.email,
        per_page: 20,
        orderby: 'date',
        order: 'desc',
      },
    });

    const visibleOrders = orders.filter((order) =>
      order.billing?.email?.trim().toLowerCase() === customer.email,
    );

    return {
      customer: {
        name: customer.name,
        email: this.maskEmail(customer.email),
      },
      orders: visibleOrders.map((order) => ({
        id: order.id,
        number: order.number ?? String(order.id),
        status: order.status ?? 'pending',
        statusLabel: this.toStatusLabel(order.status),
        total: order.total ?? '0.00',
        currency: order.currency ?? 'USD',
        placedAt: order.date_created ?? null,
        updatedAt: order.date_modified ?? null,
        tracking: this.getTrackingDetails(order),
        items: (order.line_items ?? []).map((item) => ({
          name: item.name ?? 'MelloRise Gummies',
          quantity: item.quantity ?? 1,
          total: item.total ?? null,
          image: item.image?.src ?? null,
        })),
      })),
    };
  }

  private getTrackingDetails(order: WooCommerceAccountOrder) {
    const code =
      this.getOrderMeta(order, '_wiio_tracking_code') ||
      this.getOrderMeta(order, '_headless_tracking_code');

    if (!code) return null;

    return {
      code: String(code),
      carrier: this.toNullableString(this.getOrderMeta(order, '_wiio_carrier')),
      url: this.toNullableString(this.getOrderMeta(order, '_wiio_tracking_url')),
      status: this.toNullableString(this.getOrderMeta(order, '_wiio_tracking_status')),
      updatedAt: this.toNullableString(this.getOrderMeta(order, '_wiio_tracking_updated_at')),
    };
  }

  private getOrderMeta(order: WooCommerceAccountOrder, key: string): unknown {
    return order.meta_data?.find((item) => item.key === key)?.value;
  }

  private toNullableString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }

  private toStatusLabel(status?: string): string {
    const labels: Record<string, string> = {
      pending: 'Payment pending',
      processing: 'Preparing order',
      'on-hold': 'Waiting for confirmation',
      completed: 'Delivered',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      failed: 'Payment failed',
    };

    return labels[status ?? ''] ?? 'Order received';
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!name || !domain) return email;

    return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
  }
}
