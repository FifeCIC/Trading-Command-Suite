import { PrismaClient } from '@prisma/client';
interface FaqSeedEntry {
    question: string;
    answer: string;
    category: string;
    tags: string;
    order: number;
}
export declare const FAQ_ENTRIES: FaqSeedEntry[];
export declare function seedFaq(prisma: PrismaClient): Promise<number>;
export {};
