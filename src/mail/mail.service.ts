import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type SendWelcomeDiscountInput = {
  to: string;
  code: string;
  amount: string;
  expiresAt: string;
  shopUrl: string;
};

type SendOrderTrackingInput = {
  to: string;
  orderNumber: string;
  trackingCode: string;
  trackingUrl?: string;
  carrier?: string;
  trackOrderUrl: string;
};

type SendContactMessageInput = {
  name?: string;
  email: string;
  phone?: string;
  comment: string;
};

type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string[];
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendWelcomeDiscount(input: SendWelcomeDiscountInput): Promise<boolean> {
    if (!this.isWelcomeDiscountEmailEnabled) return false;

    const sender = this.getSenderConfig('Welcome discount email');
    if (!sender) return false;

    const replyTo = this.configService.get<string>('MAIL_REPLY_TO');
    const payload: ResendEmailPayload = {
      from: sender.from,
      to: [input.to],
      subject: `Your MelloRise ${input.amount}% discount code`,
      html: this.buildWelcomeDiscountHtml(input),
      text: this.buildWelcomeDiscountText(input),
      ...(replyTo ? { reply_to: [replyTo] } : {}),
    };

    return this.sendResendEmail(sender.apiKey, payload, 'welcome discount');
  }

  async sendOrderTracking(input: SendOrderTrackingInput): Promise<boolean> {
    if (!input.to || !this.isTrackingEmailEnabled) return false;

    const sender = this.getSenderConfig('Order tracking email');
    if (!sender) return false;

    const replyTo = this.configService.get<string>('MAIL_REPLY_TO');
    const payload: ResendEmailPayload = {
      from: sender.from,
      to: [input.to],
      subject: `Your MelloRise order ${input.orderNumber} tracking is ready`,
      html: this.buildOrderTrackingHtml(input),
      text: this.buildOrderTrackingText(input),
      ...(replyTo ? { reply_to: [replyTo] } : {}),
    };

    return this.sendResendEmail(sender.apiKey, payload, 'order tracking');
  }

  async sendContactMessage(input: SendContactMessageInput): Promise<boolean> {
    const sender = this.getSenderConfig('Contact email');
    if (!sender) return false;

    const recipient =
      this.configService.get<string>('MAIL_CONTACT_TO') ||
      'mellorise.support@gmail.com';
    const payload: ResendEmailPayload = {
      from: sender.from,
      to: [recipient],
      subject: `New MelloRise contact message from ${input.email}`,
      html: this.buildContactMessageHtml(input),
      text: this.buildContactMessageText(input),
      reply_to: [input.email],
    };

    return this.sendResendEmail(sender.apiKey, payload, 'contact');
  }

  private async sendResendEmail(
    apiKey: string,
    payload: ResendEmailPayload,
    label: string,
  ): Promise<boolean> {

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.warn(
        `Resend rejected ${label} email with status ${response.status}: ${errorText}`,
      );
      return false;
    }

    return true;
  }

  private getSenderConfig(label: string): { apiKey: string; from: string } | null {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('MAIL_FROM');

    if (!apiKey || !from) {
      this.logger.warn(
        `${label} skipped because RESEND_API_KEY or MAIL_FROM is not configured`,
      );
      return null;
    }

    return { apiKey, from };
  }

  private get isWelcomeDiscountEmailEnabled(): boolean {
    return (
      this.configService.get<string>('MAIL_WELCOME_DISCOUNT_ENABLED') ?? 'true'
    )
      .trim()
      .toLowerCase() !== 'false';
  }

  private get isTrackingEmailEnabled(): boolean {
    return (this.configService.get<string>('MAIL_TRACKING_ENABLED') ?? 'true')
      .trim()
      .toLowerCase() !== 'false';
  }

  private buildWelcomeDiscountHtml(input: SendWelcomeDiscountInput): string {
    const amount = this.escapeHtml(input.amount);
    const code = this.escapeHtml(input.code);
    const shopUrl = this.escapeHtml(input.shopUrl);
    const expiresAt = this.formatExpiration(input.expiresAt);

    return `
      <div style="margin:0;background:#f7fbfa;padding:32px 16px;font-family:Arial,sans-serif;color:#102829;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce8e7;border-radius:16px;padding:28px;">
          <p style="margin:0 0 10px;color:#168f78;font-size:13px;font-weight:700;text-transform:uppercase;">Welcome offer</p>
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;">Your ${amount}% MelloRise discount is ready</h1>
          <p style="margin:0 0 22px;color:#4f5f61;font-size:16px;line-height:1.5;">Use this code on checkout before it expires.</p>
          <div style="border:1px dashed #31d6b0;border-radius:12px;background:#effcf9;padding:18px;text-align:center;">
            <p style="margin:0 0 8px;color:#4f5f61;font-size:13px;font-weight:700;text-transform:uppercase;">Discount code</p>
            <p style="margin:0;font-size:30px;font-weight:800;letter-spacing:2px;color:#102829;">${code}</p>
          </div>
          <p style="margin:18px 0 0;color:#4f5f61;font-size:14px;line-height:1.5;">Expires: ${this.escapeHtml(expiresAt)}</p>
          <a href="${shopUrl}" style="display:inline-block;margin-top:22px;background:#31d6b0;color:#062626;text-decoration:none;font-weight:800;border-radius:999px;padding:14px 22px;">Shop MelloRise</a>
        </div>
      </div>
    `;
  }

  private buildWelcomeDiscountText(input: SendWelcomeDiscountInput): string {
    return [
      `Your MelloRise ${input.amount}% discount is ready.`,
      `Code: ${input.code}`,
      `Expires: ${this.formatExpiration(input.expiresAt)}`,
      `Shop: ${input.shopUrl}`,
    ].join('\n');
  }

  private buildOrderTrackingHtml(input: SendOrderTrackingInput): string {
    const orderNumber = this.escapeHtml(input.orderNumber);
    const trackingCode = this.escapeHtml(input.trackingCode);
    const carrier = this.escapeHtml(input.carrier || 'Shipping partner');
    const trackingUrl = input.trackingUrl ? this.escapeHtml(input.trackingUrl) : '';
    const trackOrderUrl = this.escapeHtml(input.trackOrderUrl);

    return `
      <div style="margin:0;background:#f7fbfa;padding:32px 16px;font-family:Arial,sans-serif;color:#102829;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce8e7;border-radius:16px;padding:28px;">
          <p style="margin:0 0 10px;color:#168f78;font-size:13px;font-weight:700;text-transform:uppercase;">Order update</p>
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;">Your MelloRise order is on the way</h1>
          <p style="margin:0 0 22px;color:#4f5f61;font-size:16px;line-height:1.5;">Order ${orderNumber} now has tracking from ${carrier}.</p>
          <div style="border:1px dashed #77cdfa;border-radius:12px;background:#eff9ff;padding:18px;text-align:center;">
            <p style="margin:0 0 8px;color:#4f5f61;font-size:13px;font-weight:700;text-transform:uppercase;">Tracking code</p>
            <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:1.5px;color:#102829;">${trackingCode}</p>
          </div>
          ${
            trackingUrl
              ? `<a href="${trackingUrl}" style="display:inline-block;margin-top:22px;background:#31d6b0;color:#062626;text-decoration:none;font-weight:800;border-radius:999px;padding:14px 22px;">Track with carrier</a>`
              : ''
          }
          <p style="margin:18px 0 0;color:#4f5f61;font-size:14px;line-height:1.5;">You can also check your status any time on the MelloRise tracking page.</p>
          <a href="${trackOrderUrl}" style="display:inline-block;margin-top:14px;color:#0a72b8;text-decoration:underline;font-weight:700;">Open MelloRise tracking</a>
        </div>
      </div>
    `;
  }

  private buildOrderTrackingText(input: SendOrderTrackingInput): string {
    return [
      `Your MelloRise order ${input.orderNumber} is on the way.`,
      `Carrier: ${input.carrier || 'Shipping partner'}`,
      `Tracking code: ${input.trackingCode}`,
      input.trackingUrl ? `Carrier tracking: ${input.trackingUrl}` : '',
      `MelloRise tracking: ${input.trackOrderUrl}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildContactMessageHtml(input: SendContactMessageInput): string {
    const name = this.escapeHtml(input.name || 'Not provided');
    const email = this.escapeHtml(input.email);
    const phone = this.escapeHtml(input.phone || 'Not provided');
    const comment = this.escapeHtml(input.comment).replace(/\n/g, '<br>');

    return `
      <div style="margin:0;background:#f7fbfa;padding:32px 16px;font-family:Arial,sans-serif;color:#102829;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dce8e7;border-radius:16px;padding:28px;">
          <p style="margin:0 0 10px;color:#168f78;font-size:13px;font-weight:700;text-transform:uppercase;">Contact form</p>
          <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;">New MelloRise message</h1>
          <div style="margin:0 0 18px;border-top:1px solid #e4eeee;border-bottom:1px solid #e4eeee;padding:14px 0;color:#4f5f61;font-size:15px;line-height:1.55;">
            <p style="margin:0;"><strong style="color:#102829;">Name:</strong> ${name}</p>
            <p style="margin:6px 0 0;"><strong style="color:#102829;">Email:</strong> ${email}</p>
            <p style="margin:6px 0 0;"><strong style="color:#102829;">Phone:</strong> ${phone}</p>
          </div>
          <div style="font-size:16px;line-height:1.6;color:#102829;">${comment}</div>
        </div>
      </div>
    `;
  }

  private buildContactMessageText(input: SendContactMessageInput): string {
    return [
      'New MelloRise contact message',
      `Name: ${input.name || 'Not provided'}`,
      `Email: ${input.email}`,
      `Phone: ${input.phone || 'Not provided'}`,
      '',
      input.comment,
    ].join('\n');
  }

  private formatExpiration(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const replacements: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };

      return replacements[character];
    });
  }
}
