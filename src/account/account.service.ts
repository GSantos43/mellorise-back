import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedClerkCustomer } from '../auth/clerk-auth.service';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';

type WooCommerceAccountOrder = {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  subtotal?: string;
  discount_total?: string;
  shipping_total?: string;
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
  coupon_lines?: Array<{
    code?: string;
    discount?: string;
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
      orders: visibleOrders.map((order) => this.toAccountOrder(order)),
    };
  }

  async getOrderForCustomer(
    customer: AuthenticatedClerkCustomer,
    orderId: string,
  ) {
    const order = await this.wooCommerceClient.get<WooCommerceAccountOrder>(
      `/orders/${encodeURIComponent(orderId)}`,
    );

    if (order.billing?.email?.trim().toLowerCase() !== customer.email) {
      throw new NotFoundException('Order not found');
    }

    return {
      customer: {
        name: customer.name,
        email: this.maskEmail(customer.email),
      },
      order: this.toAccountOrder(order),
    };
  }

  private toAccountOrder(order: WooCommerceAccountOrder) {
    return {
      id: order.id,
      number: order.number ?? String(order.id),
      status: order.status ?? 'pending',
      statusLabel: this.toStatusLabel(order.status),
      subtotal: order.subtotal ?? null,
      discountTotal: order.discount_total ?? '0.00',
      shippingTotal: order.shipping_total ?? '0.00',
      total: order.total ?? '0.00',
      currency: order.currency ?? 'USD',
      placedAt: order.date_created ?? null,
      updatedAt: order.date_modified ?? null,
      coupon: this.getCouponDetails(order),
      promotion: this.getPromotionDetails(order),
      tracking: this.getTrackingDetails(order),
      items: (order.line_items ?? []).map((item) => ({
        name: item.name ?? 'MelloRise Gummies',
        quantity: item.quantity ?? 1,
        total: item.total ?? null,
        image: item.image?.src ?? null,
      })),
    };
  }

  private getCouponDetails(order: WooCommerceAccountOrder) {
    const coupon = order.coupon_lines?.find((item) => item.code);
    const metaCoupon = this.toNullableString(
      this.getOrderMeta(order, '_headless_coupon_code'),
    );
    const code = coupon?.code || metaCoupon;

    if (!code) return null;

    return {
      code: String(code).toUpperCase(),
      discount: coupon?.discount ?? order.discount_total ?? '0.00',
    };
  }

  private getPromotionDetails(order: WooCommerceAccountOrder) {
    const code = this.toNullableString(
      this.getOrderMeta(order, '_headless_bundle_promotion'),
    );
    const label = this.toNullableString(
      this.getOrderMeta(order, '_headless_bundle_promotion_label'),
    );

    if (!code && !label) return null;

    return {
      code,
      label: label || code,
      paidQuantity: this.toNullableString(
        this.getOrderMeta(order, '_headless_paid_quantity'),
      ),
      freeQuantity: this.toNullableString(
        this.getOrderMeta(order, '_headless_free_quantity'),
      ),
      deliveredQuantity: this.toNullableString(
        this.getOrderMeta(order, '_headless_delivered_quantity'),
      ),
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
