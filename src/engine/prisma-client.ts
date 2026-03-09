import { PrismaClient } from '@prisma/client';

// Instance singleton du client Prisma
const prisma = new PrismaClient();

export default prisma;
