import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SePayPgClient } from 'sepay-pg-node';
import { inspect } from 'util';

export type SepayMethod = 'BANK_TRANSFER' | 'NAPAS_BANK_TRANSFER';

@Injectable()
export class SepayGatewayService {
    private readonly client: SePayPgClient;
    private readonly logger = new Logger(SepayGatewayService.name);

    constructor(config: ConfigService) {
        this.client = new SePayPgClient({
            env: config.getOrThrow<'sandbox' | 'production'>('SEPAY_ENV'),
            merchant_id: config.getOrThrow<string>('SEPAY_MERCHANT_ID'),
            secret_key: config.getOrThrow<string>('SEPAY_SECRET_KEY'),
        });
    }

    buildCheckout(p: {
        invoiceNumber: string;
        amount: number;
        description: string;
        successUrl: string;
        errorUrl: string;
        cancelUrl: string;
        paymentMethod?: SepayMethod;
    }) {
        const fields = this.client.checkout.initOneTimePaymentFields({
            operation: 'PURCHASE',
            payment_method: p.paymentMethod ?? 'BANK_TRANSFER',
            order_invoice_number: p.invoiceNumber,
            order_amount: p.amount,
            currency: 'VND',
            order_description: p.description,
            success_url: p.successUrl,
            error_url: p.errorUrl,
            cancel_url: p.cancelUrl,
        });
        return { checkoutUrl: this.client.checkout.initCheckoutUrl(), fields };
    }

    // Trả về phần "data" của API chi tiết đơn hàng (order_status, order_amount, transactions...)
    async retrieveOrder(invoiceNumber: string): Promise<any> {
        // Mask invoice number trong log để bảo mật
        const maskedInvoice = invoiceNumber.length > 4
            ? invoiceNumber.slice(0, -4) + '****'
            : '****';

        try {
            // Sử dụng Promise.race để implement timeout
            const result: any = await Promise.race([
                this.client.order.retrieve(invoiceNumber),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Gateway timeout')), 10000)
                )
            ]);

            // Log cấu trúc response để kiểm chứng hình dạng thực tế - sử dụng inspect để tránh circular
            this.logger.log(`[RECONCILE DEBUG] Invoice: ${maskedInvoice}, Status: ${result?.data?.data?.order_status || result?.data?.order_status || 'UNKNOWN'}`);
            // Mình chưa biết SDK trả về response gốc hay body đã bóc, nên xử lý cả hai
            const body = result?.data ?? result;
            const extracted = body?.data ?? body;
            return extracted;
        } catch (error: any) {
            if (error.message === 'Gateway timeout') {
                this.logger.error(`[GATEWAY TIMEOUT] Timeout retrieving order ${maskedInvoice} after 10s`);
                throw new Error('Gateway timeout');
            }

            // Log error details without circular reference using util.inspect
            this.logger.error(`[GATEWAY ERROR] Failed to retrieve order ${maskedInvoice}`);
            if (error?.response) {
                this.logger.error(`Response status: ${error.response.status}`);
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            } else if (error?.request) {
                this.logger.error(`No response received from SePay API`);
            } else {
                // Use inspect with depth: 0 to avoid circular references
                const errorMsg = inspect(error, { depth: 0, maxArrayLength: 10 });
                this.logger.error(`Error details: ${errorMsg}`);
            }
            throw error;
        }
    }
}