// setStock.js
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await prisma.variant.updateMany({
    data: { stock: 5 }
  });
  console.log(`✅ Updated ${result.count} variants to stock: 5`);
}

main()
  .catch((e) => {
    console.error('❌ Failed to update stock:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });