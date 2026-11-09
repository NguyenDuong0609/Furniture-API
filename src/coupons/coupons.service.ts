import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CouponsService {
    constructor(private prisma: PrismaService) { }

    create(data: {
        code: string;
        type: 'PERCENT' | 'FIXED';
        value: number;
        minOrderAmount?: number;
        maxDiscount?: number;
        usageLimit?: number;
        startAt?: string;
        endAt?: string;
    }) {
        if (!data?.code) throw new BadRequestException('code là bắt buộc');
        if (!data?.type) throw new BadRequestException('type là bắt buộc (PERCENT hoặc FIXED)');
        if (data?.value == null) throw new BadRequestException('value là bắt buộc');
        return this.prisma.coupon.create({
            data: {
                code: data.code.toUpperCase(),
                type: data.type,
                value: data.value,
                minOrderAmount: data.minOrderAmount ?? 0,
                maxDiscount: data.maxDiscount,
                usageLimit: data.usageLimit,
                startAt: data.startAt ? new Date(data.startAt) : null,
                endAt: data.endAt ? new Date(data.endAt) : null,
            },
        });
    }

    findAll() {
        return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    }

    async update(id: number, data: any) {
        await this.findOne(id);
        return this.prisma.coupon.update({
            where: { id },
            data: {
                ...data,
                code: data.code ? data.code.toUpperCase() : undefined,
            },
        });
    }

    async remove(id: number) {
        await this.findOne(id);
        return this.prisma.coupon.delete({ where: { id } });
    }

    private async findOne(id: number) {
        const c = await this.prisma.coupon.findUnique({ where: { id } });
        if (!c) throw new NotFoundException('Coupon không tồn tại');
        return c;
    }

    /** Client validate trước khi checkout */
    async validate(code: string, orderAmount: number) {
        const coupon = await this.prisma.coupon.findUnique({
            where: { code: code.toUpperCase() },
        });

        if (!coupon || !coupon.isActive) {
            throw new BadRequestException('Mã giảm giá không hợp lệ');
        }

        const now = new Date();
        if (coupon.startAt && now < coupon.startAt) {
            throw new BadRequestException('Mã giảm giá chưa có hiệu lực');
        }
        if (coupon.endAt && now > coupon.endAt) {
            throw new BadRequestException('Mã giảm giá đã hết hạn');
        }
        if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
            throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng');
        }
        if (Number(coupon.minOrderAmount) > orderAmount) {
            throw new BadRequestException(
                `Đơn tối thiểu ${coupon.minOrderAmount}đ để dùng mã này`,
            );
        }

        let discount = 0;
        if (coupon.type === 'PERCENT') {
            discount = (orderAmount * Number(coupon.value)) / 100;
            if (coupon.maxDiscount) {
                discount = Math.min(discount, Number(coupon.maxDiscount));
            }
        } else {
            discount = Number(coupon.value);
        }
        discount = Math.min(discount, orderAmount);

        return {
            valid: true,
            code: coupon.code,
            type: coupon.type,
            discount,
            finalAmount: orderAmount - discount,
        };
    }

    async incrementUsage(code: string) {
        await this.prisma.coupon.update({
            where: { code: code.toUpperCase() },
            data: { usedCount: { increment: 1 } },
        });
    }
}
