import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var -- required pattern for global PrismaClient singleton across Vite HMR reloads
  var prisma: PrismaClient;
}

const prisma: PrismaClient = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
