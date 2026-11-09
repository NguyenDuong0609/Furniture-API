import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service.js";

// shipping.service.ts
@Injectable()
export class ShippingService {
    constructor(private prisma: PrismaService) { }

    async calculate(orderAmount: number) {
        const rules = await this.prisma.shippingRule.findMany({
            where: { isActive: true },
            orderBy: { minOrderAmount: 'desc' },
        });

        // Rule mặc định nếu chưa seed
        if (!rules.length) {
            const fee = orderAmount >= 500000 ? 0 : 30000;
            return { fee, freeShipping: fee === 0, rule: 'default' };
        }

        const rule =
            rules.find((r) => orderAmount >= Number(r.minOrderAmount)) || rules[rules.length - 1];

        if (rule.freeAbove && orderAmount >= Number(rule.freeAbove)) {
            return { fee: 0, freeShipping: true, rule: rule.name };
        }

        return {
            fee: Number(rule.fee),
            freeShipping: false,
            rule: rule.name,
        };
    }
}